import React from 'react';
import './ClinicalData.css'; 

const ClinicalData = ({ data }) => {
  return (
    <div className="clinical-data-section">
      <h3>Patient Clinical Data</h3>
      {data ? (
        <div>
          <p><strong>Name:</strong> {data.name || 'Unknown'}</p>
          <p><strong>Age:</strong> {data.age || 'Unknown'}</p>
          <p><strong>Diagnosis:</strong> {data.diagnosis || 'Unknown'}</p>
          <p><strong>Notes:</strong> {data.notes || 'None'}</p>
        </div>
      ) : (
        <p>No clinical data available.</p>
      )}
    </div>
  );
};

export default ClinicalData;
