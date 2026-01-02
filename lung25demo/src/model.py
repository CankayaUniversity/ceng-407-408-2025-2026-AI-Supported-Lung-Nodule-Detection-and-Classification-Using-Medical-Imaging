import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.models as tvm


class GridAttentionBlock2D(nn.Module):
    """
    Ozan Oktay tarzı 2D attention gate (sade).
    x: (B,C,H,W)  feature (layer3)
    g: (B,Cg,Hg,Wg) gating (layer4 feature)
    """
    def __init__(self, in_channels, gating_channels, inter_channels=None, sub_sample_factor=2):
        super().__init__()
        if inter_channels is None:
            inter_channels = max(in_channels // 2, 1)

        self.theta = nn.Conv2d(in_channels, inter_channels, kernel_size=2, stride=sub_sample_factor, bias=False)
        self.phi   = nn.Conv2d(gating_channels, inter_channels, kernel_size=1, stride=1, bias=True)
        self.psi   = nn.Conv2d(inter_channels, 1, kernel_size=1, stride=1, bias=True)

        self.W = nn.Sequential(
            nn.Conv2d(in_channels, in_channels, kernel_size=1, stride=1, bias=False),
            nn.BatchNorm2d(in_channels),
        )

        self.relu = nn.ReLU(inplace=True)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x, g):
        theta_x = self.theta(x)                 # (B,inter,H',W')
        phi_g = self.phi(g)                     # (B,inter,Hg,Wg)
        if phi_g.shape[-2:] != theta_x.shape[-2:]:
            phi_g = F.interpolate(phi_g, size=theta_x.shape[-2:], mode="bilinear", align_corners=False)

        f = self.relu(theta_x + phi_g)
        att = self.sigmoid(self.psi(f))         # (B,1,H',W')

        if att.shape[-2:] != x.shape[-2:]:
            att = F.interpolate(att, size=x.shape[-2:], mode="bilinear", align_corners=False)

        y = att * x
        y = self.W(y)
        return y, att


class ResNetWithAG(nn.Module):
    """
    ResNet18/34 üzerinde:
    - layer3 çıkışına attention gate uygula (gating = layer4(layer3))
    - layer4'ü gated feature ile tekrar çalıştır
    """
    def __init__(self, base_resnet: nn.Module):
        super().__init__()
        self.backbone = base_resnet

        c_x = self.backbone.layer3[-1].conv2.out_channels   # 256 (resnet18/34)
        c_g = self.backbone.layer4[-1].conv2.out_channels   # 512 (resnet18/34)

        self.ag = GridAttentionBlock2D(in_channels=c_x, gating_channels=c_g, inter_channels=max(c_x // 2, 1))

    def forward(self, x):
        m = self.backbone

        x = m.conv1(x)
        x = m.bn1(x)
        x = m.relu(x)
        x = m.maxpool(x)

        x = m.layer1(x)
        x = m.layer2(x)
        x3 = m.layer3(x)

        g0 = m.layer4(x3)         # gating
        x3g, _ = self.ag(x3, g0)  # gated layer3
        x4 = m.layer4(x3g)        # recompute layer4 from gated

        x = m.avgpool(x4)
        x = torch.flatten(x, 1)
        x = m.fc(x)
        return x


def _set_resnet_in_ch(m: nn.Module, in_ch: int):
    if in_ch == 3:
        return
    old = m.conv1
    m.conv1 = nn.Conv2d(
        in_ch,
        old.out_channels,
        kernel_size=old.kernel_size,
        stride=old.stride,
        padding=old.padding,
        bias=False,
    )


def build_model(backbone="resnet18", in_ch=3):
    backbone = backbone.lower()

    if backbone == "resnet18":
        m = tvm.resnet18(weights=None)
        _set_resnet_in_ch(m, in_ch)
        m.fc = nn.Linear(m.fc.in_features, 1)
        return m

    if backbone == "resnet34":
        m = tvm.resnet34(weights=None)
        _set_resnet_in_ch(m, in_ch)
        m.fc = nn.Linear(m.fc.in_features, 1)
        return m

    # attention-gated seçenekler
    if backbone == "resnet18_ag":
        m = tvm.resnet18(weights=None)
        _set_resnet_in_ch(m, in_ch)
        m.fc = nn.Linear(m.fc.in_features, 1)
        return ResNetWithAG(m)

    if backbone == "resnet34_ag":
        m = tvm.resnet34(weights=None)
        _set_resnet_in_ch(m, in_ch)
        m.fc = nn.Linear(m.fc.in_features, 1)
        return ResNetWithAG(m)

    if backbone == "densenet121":
        m = tvm.densenet121(weights=None)
        m.classifier = nn.Linear(m.classifier.in_features, 1)
        return m

    raise ValueError(f"Unknown backbone: {backbone}")


def gradcam_target_layers(model, backbone: str):
    """
    Works for:
    - Plain torchvision ResNet (model.layer4)
    - Wrapped model having .backbone (model.backbone.layer4)
    - Wrapped model having .encoder (common pattern)
    """

    if hasattr(model, "backbone"):
        m = model.backbone
    elif hasattr(model, "encoder"):
        m = model.encoder
    else:
        m = model

    if hasattr(m, "layer4"):
        return [m.layer4[-1]]

    if hasattr(m, "features"):
        return [m.features[-1]]

    raise ValueError(f"Cannot find target layer for Grad-CAM. Model type: {type(model)}")
