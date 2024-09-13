import React, { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import axios from 'axios';

const Viewer = ({ dziUrl, filename }) => {
  const viewerRef = useRef(null);
  const [viewer, setViewer] = useState(null);
  const [annotationFile, setAnnotationFile] = useState(null);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (viewerRef.current && !viewer) {
      const newViewer = OpenSeadragon({
        element: viewerRef.current,
        tileSources: dziUrl,
        showNavigationControl: false,
      });
      setViewer(newViewer);
    }
  }, [dziUrl, viewer]);

  const handleAnnotationFileChange = (event) => {
    setAnnotationFile(event.target.files[0]);
  };

  const handleAnnotationUpload = async () => {
    if (!annotationFile) {
      alert("Please select an annotation file first!");
      return;
    }

    const formData = new FormData();
    formData.append('file', annotationFile);

    try {
      await axios.post('http://localhost:5000/upload_annotations', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      loadAndDisplayAnnotations(annotationFile.name);
    } catch (error) {
      console.error('Error uploading annotation file:', error);
    }
  };

  const loadAndDisplayAnnotations = async (annotationFilename) => {
    try {
      const response = await axios.get(`http://localhost:5000/annotations/${annotationFilename}`);
      const features = response.data;

      viewer.clearOverlays();

      const image = viewer.world.getItemAt(0);
      const imageWidth = image.source.dimensions.x;
      const imageHeight = image.source.dimensions.y;

      console.log('Image dimensions:', imageWidth, imageHeight);
      console.log('First feature coordinates:', features[0].geometry.coordinates);

      features.forEach(feature => {
        feature.geometry.coordinates.forEach(point => {
          const [x, y] = point;
          
          const element = document.createElement('div');
          element.className = 'annotation-overlay';
          element.style.width = '5px';
          element.style.height = '5px';
          element.style.borderRadius = '50%';
          element.style.backgroundColor = 'red';

          const scaledX = (x + offsetX) * scale / imageWidth;
          const scaledY = (y + offsetY) * scale / imageHeight;

          viewer.addOverlay({
            element: element,
            location: new OpenSeadragon.Point(scaledX, scaledY),
            placement: OpenSeadragon.Placement.CENTER
          });
        });
      });

      viewer.viewport.goHome();
    } catch (error) {
      console.error('Error loading annotations:', error);
    }
  };

  const adjustAnnotations = () => {
    loadAndDisplayAnnotations(annotationFile.name);
  };

  return (
    <div>
      <div id="openseadragon-viewer" ref={viewerRef} style={{ width: '100%', height: '600px' }}></div>
      <div>
        <input type="file" onChange={handleAnnotationFileChange} accept=".json,.geojson" />
        <button onClick={handleAnnotationUpload}>Upload Annotations</button>
      </div>
      <div>
        <label>Offset X: <input type="number" value={offsetX} onChange={(e) => setOffsetX(Number(e.target.value))} /></label>
        <label>Offset Y: <input type="number" value={offsetY} onChange={(e) => setOffsetY(Number(e.target.value))} /></label>
        <label>Scale: <input type="number" value={scale} onChange={(e) => setScale(Number(e.target.value))} step="0.1" /></label>
        <button onClick={adjustAnnotations}>Adjust Annotations</button>
      </div>
    </div>
  );
};

export default Viewer;