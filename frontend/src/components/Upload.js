/// Making sure your Upload component calls the onSuccess handler with the correct DZI path after a successful upload.

import React, { useState } from 'react';
import axios from 'axios';

const Upload = ({ onSuccess }) => {
  const [file, setFile] = useState(null);
  const [uploadType, setUploadType] = useState('wsi'); // 'wsi' or 'patch'

  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) {
      alert("Please select a file first!");
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    const endpoint = uploadType === 'patch'
      ? `${process.env.REACT_APP_BACKEND_URL}/upload_patch`
      : `${process.env.REACT_APP_BACKEND_URL}/upload`;

    try {
      const response = await axios.post(endpoint, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.dzi_path) {
        onSuccess(response.data.dzi_path);
      } else {
        console.error('DZI path not found in response:', response.data);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '8px' }}>
        <label>
          <input
            type="radio"
            value="wsi"
            checked={uploadType === 'wsi'}
            onChange={() => setUploadType('wsi')}
          />
          Upload WSI
        </label>
        <label style={{ marginLeft: '16px' }}>
          <input
            type="radio"
            value="patch"
            checked={uploadType === 'patch'}
            onChange={() => setUploadType('patch')}
          />
          Upload Patch
        </label>
      </div>
      <input type="file" onChange={handleFileChange} />
      <button className='upload-btn' onClick={handleUpload}>Upload</button>
    </div>
  );
};

export default Upload;
