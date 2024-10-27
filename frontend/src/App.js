import React, { useState } from 'react';
import Upload from './components/Upload';
import Viewer from './components/Viewer';
import './App.css'; // Importing App CSS

const App = () => {
  const [dziUrl, setDziUrl] = useState('');
  const [filename, setFilename] = useState('');

  const handleUploadSuccess = (dziPath) => {
    const url = `${process.env.REACT_APP_BACKEND_URL}/output/${dziPath}`;
    setDziUrl(url);
    setFilename(dziPath.split('.dzi')[0]); // Extract filename without .dzi extension
  };
  

  return (
    <div className='app-container'>
      <h1 className="page-title">Upload WSI</h1>
      <Upload onSuccess={handleUploadSuccess} />
      {dziUrl && <Viewer dziUrl={dziUrl} filename={filename} />}
      {!dziUrl && <Viewer dziUrl={""} filename={filename} />}
    </div>
  );
};

export default App;
