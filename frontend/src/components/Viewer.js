import React, { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import axios from 'axios';
import * as PIXI from 'pixi.js';
import { Application } from 'pixi.js';
import './Viewer.css'; // Import the stylesheet

const Viewer = ({ dziUrl, filename }) => {
  const viewerRef = useRef(null);
  const [viewer, setViewer] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [visibleAnnotations, setVisibleAnnotations] = useState({});
  const [annotationTypes, setAnnotationTypes] = useState([]);
  const [zoomValue, setZoomValue] = useState(0); // State to control zoom slider

  const pixiAppRef = useRef(null);
  const annotationGraphicsRef = useRef(null);
  const [annotationFile, setAnnotationFile] = useState(null); // Define annotation file state

  const initializePixiApp = () => {
    const canvas = document.createElement('canvas');
    const view = canvas.transferControlToOffscreen();
  
    const app = new Application();
  
    app.init({
      view,
      backgroundAlpha: 0,  // Ensure the canvas is fully transparent
      resizeTo: viewerRef.current,  // Ensure the canvas resizes with the viewer
    }).then(() => {
      viewerRef.current.appendChild(canvas);  // Append the OffscreenCanvas to the viewer
      pixiAppRef.current = app;
  
      // Create the graphics container for annotations
      annotationGraphicsRef.current = new PIXI.Graphics();
      app.stage.addChild(annotationGraphicsRef.current);
    }).catch(err => console.error("PixiJS Initialization error: ", err));
  };

  // Add blur to the viewer
  const addBlur = () => {
    const viewerElement = document.getElementById('openseadragon-viewer');
    viewerElement.classList.add('blur');
  };

  const getViewportBounds = () => {
    if (!viewer) return null;
  
    // Get the current viewport rectangle in image coordinates
    const viewportRect = viewer.viewport.getBounds(true); // Get the viewport bounds in viewport coordinates
    const imageRect = viewer.viewport.viewportToImageRectangle(viewportRect); // Convert it to image coordinates
  
    return {
      xMin: imageRect.x,
      xMax: imageRect.x + imageRect.width,
      yMin: imageRect.y,
      yMax: imageRect.y + imageRect.height,
    };
  };
  
  const getVisibleAnnotations = (annotations) => {
    const bounds = getViewportBounds();
    if (!bounds) return [];
  
    return annotations.map((annotation) => {
      const { geometry } = annotation;
      if (!geometry || !geometry.coordinates) return null;
  
      let filteredGeometry = { ...geometry };
  
      if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
        // Filter Polygon or MultiPolygon coordinates to only those within the bounds
        filteredGeometry.coordinates = geometry.coordinates.map((polygon) => {
          return polygon.map((ring) => {
            return ring.filter(([x, y]) => {
              return (
                x >= bounds.xMin &&
                x <= bounds.xMax &&
                y >= bounds.yMin &&
                y <= bounds.yMax
              );
            });
          }).filter((ring) => ring.length > 0);
        }).filter((polygon) => polygon.length > 0);
      } else if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
        // Filter Point or MultiPoint coordinates to only those within the bounds
        filteredGeometry.coordinates = geometry.coordinates.filter(([x, y]) => {
          return (
            x >= bounds.xMin &&
            x <= bounds.xMax &&
            y >= bounds.yMin &&
            y <= bounds.yMax
          );
        });
      }
  
      return filteredGeometryHasData(filteredGeometry) ? { ...annotation, geometry: filteredGeometry } : null;
    }).filter((annotation) => annotation !== null);
  };
  
  // Helper function to check if filtered geometry still has valid data
  const filteredGeometryHasData = (geometry) => {
    if (!geometry.coordinates) return false;
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      return geometry.coordinates.length > 0 && geometry.coordinates.some(polygon => polygon.length > 0);
    }
    if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
      return geometry.coordinates.length > 0;
    }
    return false;
  };
  
  
  const removeBlur = () => {
    const viewerElement = document.getElementById('openseadragon-viewer');
    viewerElement.classList.remove('blur');
  };

  // Show loading spinner
  const showLoadingSpinner = () => {
    const spinner = document.getElementById('loadingSpinner');
    spinner.style.display = 'block';
  };

  // Hide loading spinner
  const hideLoadingSpinner = () => {
    const spinner = document.getElementById('loadingSpinner');
    spinner.style.display = 'none';
  };

  const handlePanZoomStart = () => {
    console.log('Pan/Zoom started');
    addBlur();
    showLoadingSpinner();
  };
  
  const handlePanZoomEnd = () => {
    console.log('Pan/Zoom finished');
    removeBlur();
    hideLoadingSpinner();
    drawAnnotationsWithPixi();  // Re-draw annotations after zoom/pan ends
  };
  
  const drawAnnotationsWithPixi = () => {
    if (!viewer || !viewer.world || !pixiAppRef.current || !annotationGraphicsRef.current) return;
  
    const graphics = annotationGraphicsRef.current;
    graphics.clear(); // Clear previous drawings
  
    const visibleAnnotationsList = getVisibleAnnotations(annotations); // Get filtered annotations with only visible parts
  
  
    visibleAnnotationsList.forEach((feature) => {
      const { classification } = feature.properties;
      const { geometry } = feature;
  
      if (!geometry || !geometry.coordinates) return;
  
      const rgbToHex = (r, g, b) => (r << 16) + (g << 8) + b;
      const hexColor = rgbToHex(classification.color[0], classification.color[1], classification.color[2]);
  
      if (geometry.type === 'MultiPolygon' || geometry.type === 'Polygon') {
        graphics.beginFill(hexColor); // Start the fill
  
        geometry.coordinates.forEach((polygon) => {
          polygon.forEach((ring) => {
            ring.forEach(([x, y], index) => {
              // Convert image coordinates to viewport coordinates
              const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
  
              // Convert viewport coordinates to viewer element coordinates (screen coordinates)
              const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
  
              const adjustedX = screenPoint.x;
              const adjustedY = screenPoint.y;
  
              if (index === 0) {
                graphics.moveTo(adjustedX, adjustedY);
              } else {
                graphics.lineTo(adjustedX, adjustedY);
              }
            });
            graphics.closePath();
          });
        });
  
        graphics.endFill(); // Finish the fill
      }
  
      // Handle MultiPoint or Point
      if (geometry.type === 'MultiPoint' || geometry.type === 'Point') {
        geometry.coordinates.forEach(([x, y]) => {
          const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
          const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
  
          const adjustedX = screenPoint.x;
          const adjustedY = screenPoint.y;
  
          graphics.beginFill(hexColor);
          graphics.drawCircle(adjustedX, adjustedY, 2); // Adjust the radius for visibility
          graphics.endFill();
        });
      }
    });
  
    // Ensure rendering
    pixiAppRef.current.renderer.render(pixiAppRef.current.stage);
  };
  
  // Update the canvas size when the viewer resizes
  const updatePixiAppSize = () => {
    if (pixiAppRef.current && viewerRef.current) {
      const app = pixiAppRef.current;
      app.renderer.resize(viewerRef.current.clientWidth, viewerRef.current.clientHeight);
      drawAnnotationsWithPixi();
    }
  };

  useEffect(() => {
    if (viewer) {
      const updateZoomValue = () => {
        setZoomValue(viewer.viewport.getZoom());
      };
  
      viewer.addHandler('zoom', updateZoomValue);
  
      return () => {
        viewer.removeHandler('zoom', updateZoomValue);
      };
    }
  }, [viewer]);
  

  // Load and display annotations
  const loadAndDisplayAnnotations = async (annotationFilename) => {
    try {
      const response = await axios.get(`http://localhost:5000/annotations/${annotationFilename}`);
      const features = response.data;

      setAnnotations(features);
      const uniqueTypes = [...new Set(features.map((feature) => feature.properties.classification.name))];

      setAnnotationTypes(uniqueTypes);
      setVisibleAnnotations(uniqueTypes.reduce((acc, type) => ({ ...acc, [type]: true }), {}));

      if (viewer) {
        updatePixiAppSize(); // Ensure that annotations are drawn when loaded
      }
    } catch (error) {
      console.error('Error loading annotations:', error);
    }
  };

  // Toggle annotation visibility
  const handleToggleAnnotation = (type) => {
    setVisibleAnnotations((prevState) => ({
      ...prevState,
      [type]: !prevState[type],
    }));
  };
  useEffect(() => {
    if (viewerRef.current && !viewer) {
      const newViewer = OpenSeadragon({
        element: viewerRef.current,
        tileSources: dziUrl,
        showNavigationControl: false,
      });
  
      newViewer.addHandler('open', () => {
        setViewer(newViewer);
        setZoomValue(newViewer.viewport.getZoom()); // Initialize slider with current zoom
        initializePixiApp();
      });
      newViewer.addHandler('animation-start', handlePanZoomStart);  // Trigger blur and spinner when zoom starts
      newViewer.addHandler('animation-finish', handlePanZoomEnd);  // Remove blur and spinner after the animation ends
  
      return () => {
        newViewer.removeHandler('animation-start', handlePanZoomStart);
        newViewer.removeHandler('animation-finish', handlePanZoomEnd);
      };
    }
  }, [dziUrl, viewer]);
  
  useEffect(() => {
    if (annotations.length > 0) {
      drawAnnotationsWithPixi();
    }
  }, [visibleAnnotations, annotations, zoomValue]);

  const handleZoomChange = (event) => {
    const zoomLevel = parseFloat(event.target.value);
    if (viewer) {
      viewer.viewport.zoomTo(zoomLevel);
    }
  };
  let animationFrameId = null;

const handlePanZoom = () => {
  if (animationFrameId) {
    // cancelAnimationFrame(animationFrameId);
  }
  animationFrameId = requestAnimationFrame(() => {
    drawAnnotationsWithPixi();
    animationFrameId = null;
  });
};

// Attach pan and zoom event handlers to the viewer
useEffect(() => {
  if (viewer) {
    viewer.addHandler('pan', handlePanZoom);
    viewer.addHandler('zoom', handlePanZoom);
    viewer.addHandler('animation', handlePanZoom);
    viewer.addHandler('animation-start', handlePanZoomStart);  // Trigger blur and spinner when zoom starts
    viewer.addHandler('animation-finish', handlePanZoomEnd);  // Remove blur and spinner after the animation ends

    return () => {
      viewer.removeHandler('pan', handlePanZoom);
      viewer.removeHandler('zoom', handlePanZoom);
      viewer.removeHandler('animation', handlePanZoom);
      viewer.removeHandler('animation-start', handlePanZoomStart);  // Trigger blur and spinner when zoom starts
      viewer.removeHandler('animation-finish', handlePanZoomEnd);  // Remove blur and spinner after the animation ends
    };
  }
}, [viewer, annotations, visibleAnnotations]);


  const handleAnnotationFileChange = (event) => {
    setAnnotationFile(event.target.files[0]);
  };

  const handleAnnotationUpload = async () => {
    if (!annotationFile) {
      alert('Please select an annotation file first!');
      return;
    }

    const formData = new FormData();
    formData.append('file', annotationFile);

    try {
      await axios.post('http://localhost:5000/upload_annotations', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      await loadAndDisplayAnnotations(annotationFile.name);
      updatePixiAppSize(); // Ensure canvas and annotations are redrawn after upload
    } catch (error) {
      console.error('Error uploading annotation file:', error);
    }
  };

  return (
    <div className="viewer-container">
      <div className="viewer-header">
        <h1>Whole Slide Image Viewer</h1>
      </div>
      <div className="viewer-wrapper">
        <div className="viewer-box">
          <div id="openseadragon-viewer" ref={viewerRef} className="wsi-viewer"></div>
          <div className="loading-spinner" id="loadingSpinner"></div> 
          //Commented out for now loading spinner
          {/* Legend Box */}
          <div className="annotation-legend">
            <ul>
              {annotationTypes.map((type) => {
                const color = annotations.find((feature) => feature.properties.classification.name === type)?.properties.classification.color;
                if (!color) return null;

                return (
                  <li key={type} style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '15px',
                        height: '15px',
                        backgroundColor: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
                        marginRight: '10px',
                      }}
                    ></span>
                    {type}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      <div className="zoom-slider-container">
        <input
          id="zoomSlider"
          className="zoom-slider"
          type="range"
          min={viewer ? viewer.viewport.getMinZoom() : 0.1}
          max={viewer ? viewer.viewport.getMaxZoom() : 2}
          step={0.01}
          value={zoomValue}
          onChange={handleZoomChange}
        />
      </div>

      <div className="annotation-toggles">
        <h3>Toggle Annotations</h3>
        {annotationTypes.map((type) => (
          <div key={type}>
            <label>
              <input
                type="checkbox"
                checked={visibleAnnotations[type]}
                onChange={() => handleToggleAnnotation(type)}
              />
              {type}
            </label>
          </div>
        ))}
        {!annotationTypes.length > 0 && <>Please Upload Annotations!</>}
      </div>

      <div className="upload-section">
        <input type="file" onChange={handleAnnotationFileChange} accept=".json,.geojson" />
        <button onClick={handleAnnotationUpload} className="upload-btn">
          Upload Annotations
        </button>
      </div>
    </div>
  );
};

export default Viewer;