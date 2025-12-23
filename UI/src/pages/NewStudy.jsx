import { useState } from 'react';
import './NewStudy.css';

function NewStudy() {
  const [formData, setFormData] = useState({
    patientID: '',
    nameSurname: '',
    age: '',
    gender: '',
    clinicalNote: ''
  });
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleInputChange = (e) => {
    setFormData({...formData, [e.target.name]: e.target.value});
  };

  const startAnalysis = () => {
    setIsProcessing(true);
    let p = 0;
    const interval = setInterval(() => {
      p += 20;
      setProgress(p);
      if (p >= 100) clearInterval(interval);
    }, 400);
  };

  const submitResults = () => {
    alert('Study submitted. You can view it in your worklist.');
    // Reset form
    setFormData({patientID: '', nameSurname: '', age: '', gender: '', clinicalNote: ''});
    setProgress(0);
    setIsProcessing(false);
  };

  return (
    <div className="worklist">
      <div className="worklist-header">
        <h2>New Study</h2>
        <p>Add a new CT study and start AI analysis (mock)</p>
      </div>

      <div className="dashboard-section">
        <div className="patient-info-section">
          <div>
            <h3>Patient Information</h3>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <input 
                name="patientID" 
                placeholder="Patient ID" 
                value={formData.patientID}
                onChange={handleInputChange}
                className="new-study-input"
              />
              <input 
                name="nameSurname" 
                placeholder="Name Surname" 
                value={formData.nameSurname}
                onChange={handleInputChange}
                className="new-study-input"
              />
              <input 
                name="age" 
                placeholder="Age" 
                value={formData.age}
                onChange={handleInputChange}
                className="new-study-input"
              />
              <input 
                name="gender" 
                placeholder="Gender" 
                value={formData.gender}
                onChange={handleInputChange}
                className="new-study-input"
              />
              <input 
                name="clinicalNote" 
                placeholder="Short clinical note" 
                value={formData.clinicalNote}
                onChange={handleInputChange}
                className="new-study-input"
                style={{gridColumn:'1/3'}}
              />
            </div>
          </div>
          <button className="save-btn">Save</button>
        </div>
      </div>

      <div className="dashboard-section">
        <h3>Image Upload</h3>
        <div style={{display:'flex',gap:8}}>
          <button className="open-btn">Choose DICOM Folder</button>
          <button className="open-btn">Upload NIfTI</button>
          <button className="open-btn" onClick={startAnalysis} disabled={isProcessing}>Start AI Analysis</button>
        </div>

        {isProcessing && (
          <div style={{marginTop:16}}>
            <div style={{background:'#1b2430',borderRadius:8,overflow:'hidden'}}>
              <div style={{height:12,width:`${progress}%`,background:'#3b82f6',transition:'width 300ms'}} />
            </div>
            <p style={{marginTop:8}}>
              <strong>Processing:</strong> {progress < 100 ? 'In progress' : 'Process completed'}
            </p>
            {progress === 100 && (
              <button className="submit-btn" onClick={submitResults}>Submit</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default NewStudy;
