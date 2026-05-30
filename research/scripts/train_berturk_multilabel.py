import argparse
import json
import math
import random
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer, Trainer, TrainingArguments

from nlp_analysis import LABEL_ID_ALIASES, MODEL_NAME, SIGNAL_DEFS, canonicalize_label_id, normalize_text


LABEL_NAMES = [definition['id'] for definition in SIGNAL_DEFS]
DEFAULT_THRESHOLD = 0.5


def parse_args():
    parser = argparse.ArgumentParser(description='Fine-tune BERTurk for multi-label clinical risk signal classification.')
    parser.add_argument('--train-file', required=True, help='Path to training JSONL file.')
    parser.add_argument('--val-file', help='Optional validation JSONL file. If omitted, a validation split is created from train data.')
    parser.add_argument('--output-dir', required=True, help='Directory to save the fine-tuned model.')
    parser.add_argument('--model-name', default=MODEL_NAME, help='Base model name or local path.')
    parser.add_argument('--epochs', type=int, default=4)
    parser.add_argument('--batch-size', type=int, default=4)
    parser.add_argument('--learning-rate', type=float, default=2e-5)
    parser.add_argument('--max-length', type=int, default=256)
    parser.add_argument('--weight-decay', type=float, default=0.01)
    parser.add_argument('--warmup-ratio', type=float, default=0.1)
    parser.add_argument('--validation-ratio', type=float, default=0.2)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--threshold', type=float, default=DEFAULT_THRESHOLD)
    return parser.parse_args()


def set_seed(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def resolve_text(row):
    text = normalize_text(row.get('text'))
    if text:
        return text

    parts = [
        row.get('clinical_note'),
        row.get('description'),
        row.get('note'),
    ]
    combined = ' '.join(normalize_text(part) for part in parts if normalize_text(part))
    if not combined:
        raise ValueError('Each row must include either "text" or one of clinical_note/description/note.')
    return combined


def resolve_labels(row):
    label_vector = [0.0] * len(LABEL_NAMES)
    if isinstance(row.get('labels'), dict):
        labels = row['labels']
        for index, label_name in enumerate(LABEL_NAMES):
            label_vector[index] = float(bool(labels.get(label_name, 0) or labels.get(next((legacy for legacy, canonical in LABEL_ID_ALIASES.items() if canonical == label_name), ''), 0)))
        return label_vector

    positive_labels = row.get('positive_labels') or row.get('risk_labels') or row.get('labels') or []
    if not isinstance(positive_labels, list):
        raise ValueError('labels must be a dict or list of label ids.')
    positive_label_set = {canonicalize_label_id(str(label)) for label in positive_labels}
    for index, label_name in enumerate(LABEL_NAMES):
        label_vector[index] = float(label_name in positive_label_set)
    return label_vector


def load_jsonl_records(file_path):
    path = Path(file_path)
    records = []
    with path.open('r', encoding='utf-8') as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            row = json.loads(line)
            records.append({
                'text': resolve_text(row),
                'labels': resolve_labels(row),
            })
    if not records:
        raise ValueError(f'No records found in {file_path}')
    return records


def split_records(records, validation_ratio, seed):
    shuffled = list(records)
    random.Random(seed).shuffle(shuffled)
    val_size = max(1, int(len(shuffled) * validation_ratio)) if len(shuffled) > 1 else 0
    if val_size == 0:
        return shuffled, []
    return shuffled[val_size:], shuffled[:val_size]


class ClinicalRiskDataset(Dataset):
    def __init__(self, records, tokenizer, max_length):
        self.records = records
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self):
        return len(self.records)

    def __getitem__(self, index):
        row = self.records[index]
        encoded = self.tokenizer(
            row['text'],
            truncation=True,
            padding='max_length',
            max_length=self.max_length,
            return_tensors='pt',
        )
        item = {key: value.squeeze(0) for key, value in encoded.items()}
        item['labels'] = torch.tensor(row['labels'], dtype=torch.float32)
        return item


def compute_metrics(eval_pred):
    logits, labels = eval_pred
    probabilities = 1.0 / (1.0 + np.exp(-logits))
    predictions = (probabilities >= DEFAULT_THRESHOLD).astype(np.int32)
    labels = labels.astype(np.int32)

    true_positive = int(np.logical_and(predictions == 1, labels == 1).sum())
    false_positive = int(np.logical_and(predictions == 1, labels == 0).sum())
    false_negative = int(np.logical_and(predictions == 0, labels == 1).sum())

    precision = true_positive / max(true_positive + false_positive, 1)
    recall = true_positive / max(true_positive + false_negative, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-8)
    subset_accuracy = float((predictions == labels).all(axis=1).mean()) if len(labels) else 0.0
    return {
        'micro_precision': precision,
        'micro_recall': recall,
        'micro_f1': f1,
        'subset_accuracy': subset_accuracy,
    }


def save_training_metadata(output_dir, args, train_size, val_size):
    metadata = {
        'base_model': args.model_name,
        'label_names': LABEL_NAMES,
        'threshold': args.threshold,
        'epochs': args.epochs,
        'batch_size': args.batch_size,
        'learning_rate': args.learning_rate,
        'max_length': args.max_length,
        'train_size': train_size,
        'val_size': val_size,
    }
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    (Path(output_dir) / 'training_config.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')


def main():
    args = parse_args()
    set_seed(args.seed)

    train_records = load_jsonl_records(args.train_file)
    if args.val_file:
        val_records = load_jsonl_records(args.val_file)
    else:
        train_records, val_records = split_records(train_records, args.validation_ratio, args.seed)

    tokenizer = AutoTokenizer.from_pretrained(args.model_name)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model_name,
        num_labels=len(LABEL_NAMES),
        problem_type='multi_label_classification',
        id2label={index: label for index, label in enumerate(LABEL_NAMES)},
        label2id={label: index for index, label in enumerate(LABEL_NAMES)},
    )

    train_dataset = ClinicalRiskDataset(train_records, tokenizer, args.max_length)
    eval_dataset = ClinicalRiskDataset(val_records, tokenizer, args.max_length) if val_records else None

    effective_batch_size = max(1, args.batch_size)
    logging_steps = max(1, math.ceil(len(train_dataset) / effective_batch_size)) if len(train_dataset) else 1
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=effective_batch_size,
        per_device_eval_batch_size=effective_batch_size,
        learning_rate=args.learning_rate,
        weight_decay=args.weight_decay,
        warmup_ratio=args.warmup_ratio,
        logging_steps=logging_steps,
        save_strategy='epoch',
        eval_strategy='epoch' if eval_dataset else 'no',
        load_best_model_at_end=bool(eval_dataset),
        metric_for_best_model='micro_f1',
        greater_is_better=True,
        report_to='none',
        fp16=torch.cuda.is_available(),
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        compute_metrics=compute_metrics if eval_dataset else None,
    )

    trainer.train()
    trainer.save_model(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)
    save_training_metadata(args.output_dir, args, len(train_records), len(val_records))

    if eval_dataset:
        metrics = trainer.evaluate()
        print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
