// Ensure that the Viewer component is correctly used in the App.js file.

import React, { useState } from 'react';
import Upload from './components/Upload';
import Viewer from './components/Viewer';

const App = () => {
  const [dziUrl, setDziUrl] = useState('');
  const [filename, setFilename] = useState('');

  const handleUploadSuccess = (dziPath) => {
    const url = `http://localhost:5000/output/${dziPath}`;
    setDziUrl(url);
    setFilename(dziPath.split('.dzi')[0]); // Extract filename without .dzi extension
  };

  return (
    <div>
      <h1>Cell Annotator</h1>
      <Upload onSuccess={handleUploadSuccess} />
      {dziUrl && <Viewer dziUrl={dziUrl} filename={filename} />}
    </div>
  );
};

export default App;
