import React, { useState } from 'react';
import axios from 'axios';

const AnnotationUploader = ({ dziFilename }) => {
  const [annotationFiles, setAnnotationFiles] = useState([]); // Store uploaded annotation files

  const handleAnnotationFileChange = (event) => {
    if (event.target.files && event.target.files.length > 0) {
      const filesArray = Array.from(event.target.files);
      setAnnotationFiles(filesArray); // Set files in state
    } else {
      console.warn('No files selected');
    }
  };

  const handleAnnotationUpload = async (file) => {
    if (!file) {
      alert('Please select an annotation file first!');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('dziFile', dziFilename); // Link the annotation file to the current DZI file

    try {
      await axios.post('http://localhost:5000/link_annotation_to_dzi', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      alert(`Successfully uploaded annotation ${file.name} linked to DZI: ${dziFilename}`);
    } catch (error) {
      console.error('Error uploading annotation file:', error);
      alert(`Error uploading annotation ${file.name}`);
    }
  };

  const handleMultipleAnnotationUpload = async () => {
    if (annotationFiles.length === 0) {
      alert('No files selected for upload.');
      return;
    }

    for (let file of annotationFiles) {
      await handleAnnotationUpload(file);
    }

    setAnnotationFiles([]); // Clear state after processing
  };

  return (
    <div className="annotation-uploader">
      <h3>Upload Annotations and Link to DZI: {dziFilename}</h3>
      <input type="file" onChange={handleAnnotationFileChange} accept=".json,.geojson" multiple />
      <button onClick={handleMultipleAnnotationUpload} className="upload-btn">
        Upload Annotations
      </button>
    </div>
  );
};

export default AnnotationUploader;
