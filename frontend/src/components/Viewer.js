import React, { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import axios from 'axios';
import * as PIXI from 'pixi.js';
import { Application } from 'pixi.js';
import './Viewer.css'; 
import AnnotationUploader from './AnnotationUploader';  

const Viewer = ({ dziUrl, filename }) => {
  const viewerRef = useRef(null);
  const [viewer, setViewer] = useState(null);
  const [annotationTypes, setAnnotationTypes] = useState([]);
  const [zoomValue, setZoomValue] = useState(0); 
  const pixiAppRef = useRef(null);
  const annotationGraphicsRef = useRef(null);
  const [annotations, setAnnotations] = useState([]); // Holds multiple annotation datasets
  const [visibleAnnotations, setVisibleAnnotations] = useState({});
  const [annotationFiles, setAnnotationFiles] = useState([]); // Store the uploaded annotation files
  const [linkedAnnotations, setLinkedAnnotations] = useState([]); // State for linked annotations
  const [availableImages, setAvailableImages] = useState([]); // Store available images
  const [selectedImage, setSelectedImage] = useState(filename || ''); // Track selected image
  const [currentDziUrl, setCurrentDziUrl] = useState(dziUrl); // Manage the selected DZI URL
  const [annotationsByFile, setAnnotationsByFile] = useState({}); // Store annotations grouped by filename
  const [notification, setNotification] = useState('');


  const fetchAvailableImages = async () => {
    try {
      const response = await axios.get(`${process.env.REACT_APP_BACKEND_URL}/available_images`);
      setAvailableImages(response.data.images);
    } catch (error) {
      console.error('Error fetching available images:', error);
    }
  };

  useEffect(() => {
    fetchAvailableImages();
  }, []);

  const handleImageChange = async (event) => {
    const selectedImage = event.target.value;
    setSelectedImage(selectedImage); // Update filename
    setCurrentDziUrl(`${process.env.REACT_APP_BACKEND_URL}/output/${selectedImage}`); // Update DZI URL
  
    const imageFilename = selectedImage.replace('.dzi', ''); // Remove .dzi from the filename
    const bounds = getViewportBounds();
    if(bounds)
    {
      await fetchNormalizedAnnotations(bounds, imageFilename); // Fetch linked annotations
    }
  };
  
  
  
  

  const initializePixiApp = () => {
    const canvas = document.createElement('canvas');
    const view = canvas.transferControlToOffscreen();
  
    const app = new Application();
  
    app.init({
      view,
      backgroundAlpha: 0,  
      resizeTo: viewerRef.current, 
    }).then(() => {
      viewerRef.current.appendChild(canvas); 
      pixiAppRef.current = app;
      annotationGraphicsRef.current = new PIXI.Graphics();
      app.stage.addChild(annotationGraphicsRef.current);
    }).catch(err => console.error("PixiJS Initialization error: ", err));
  };

  const addBlur = () => {
    showLoadingSpinner()
    const graphics = annotationGraphicsRef.current;
    if(graphics)
    {
      graphics.clear();
    }
    const viewerElement = document.getElementById('openseadragon-viewer');
    viewerElement.classList.add('blur');
  };

  const getViewportBounds = () => {
    if (!viewer) return null;
  
    const viewportRect = viewer.viewport.getBounds(true); 
    const imageRect = viewer.viewport.viewportToImageRectangle(viewportRect); 
  
    return {
      xMin: imageRect.x,
      xMax: imageRect.x + imageRect.width,
      yMin: imageRect.y,
      yMax: imageRect.y + imageRect.height,
    };
  };
  
  const fetchNormalizedAnnotations = async (bounds, filename) => {
    const currentZoom = viewer.viewport.getZoom();
  
    if (currentZoom <= 7) {
      setNotification('Zoom in to view annotations.');
      return;
    }
  
    try {
      addBlur();
      const response = await axios.post(
        `${process.env.REACT_APP_BACKEND_URL}/get_normalized_annotations`,
        { bounds, filename }
      );
  
      const data = response.data;
      if (!data || Object.keys(data).length === 0) {
        setNotification('No annotations visible in the current viewport.');
        return;
      }
  
      setAnnotationsByFile(data); // Group annotations by filename
      setNotification(''); // Clear notification if annotations are found
      removeBlur();
      return data;
    } catch (error) {
      console.error("Error fetching normalized annotations:", error);
      setNotification('Error fetching annotations. Please try again.');
      return {};
    }
  };
  
  
  
  
  
  
  const filteredGeometryHasData = (geometry) => {
    if (!geometry.coordinates) return false;
  
    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      return geometry.coordinates.length > 0 && geometry.coordinates.some((ring) => ring.length > 0);
    }
  
    if (geometry.type === "Point" || geometry.type === "MultiPoint") {
      return geometry.coordinates.length > 0;
    }
  
    return false;
  };
  
  
  const removeBlur = () => {
    const viewerElement = document.getElementById('openseadragon-viewer');
    viewerElement.classList.remove('blur');
  };

  const showLoadingSpinner = () => {
    setLoadingStatus(true);
    const spinnerContainer = document.getElementsByClassName('loading-spinner');
    if (spinnerContainer.length > 0) {
      spinnerContainer[0].style.display = 'block'; // Access the first element
    } else {
      console.warn("Spinner container not found");
    }
  };
  
  const hideLoadingSpinner = () => {
    setLoadingStatus(false);
    const spinnerContainer = document.getElementsByClassName('loading-spinner');
    if (spinnerContainer.length > 0) {
      spinnerContainer[0].style.display = 'none'; // Access the first element
    } else {
      console.warn("Spinner container not found");
    }
  };
  

  const handlePanZoomStart = () => {
    showLoadingSpinner();
    setAnnotationsByFile({});
    const graphics = annotationGraphicsRef.current;
    if(graphics)
    {
      graphics.clear();
    }
  };
  const drawAnnotationsWithPixi = () => {
    if (!viewer || !pixiAppRef.current) {
      console.warn("Viewer or PixiJS is not initialized.");
      return;
    }
  
    const currentZoom = viewer.viewport.getZoom();
    if (currentZoom <= 7) {
      pixiAppRef.current.stage.removeChildren(); // Clear all drawings
      pixiAppRef.current.renderer.render(pixiAppRef.current.stage);
      return;
    }
  
  
    // Clear previous annotations for all types
    pixiAppRef.current.stage.removeChildren();
  
    // Iterate through annotations grouped by filename
    Object.entries(annotationsByFile).forEach(([filename, annotationGroup]) => {
      const fileVisibility = visibleAnnotations[filename];
      if (!fileVisibility) return; // Skip if no visibility settings for this file
  
      // Log annotation file processing
  
      // Draw each annotation
      annotationGroup.forEach((annotation, annotationIndex) => {
        const { geometry, properties } = annotation;
  
        if (!geometry || !filteredGeometryHasData(geometry)) {
          console.warn(`Annotation ${annotationIndex} skipped: Invalid or empty geometry.`, annotation);
          return;
        }
  
        // Log geometry type
  
        // Check if the annotation type is visible
        const annotationType = properties.classification.name;
        const isVisible = fileVisibility[annotationType];
        if (!isVisible) {
          return;
        }
  
        // Ensure the annotation has valid color information
        const color = properties?.classification?.color;
        if (!color) {
          console.warn(`Annotation ${annotationIndex} skipped: Missing color information.`, annotation);
          return;
        }
  
        // Create a new Graphics object for this annotation type
        const graphics = new PIXI.Graphics();
  
        // Convert RGB color to hexadecimal
        const hexColor = (color[0] << 16) + (color[1] << 8) + color[2];
  
        if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
          // Handle Polygon and MultiPolygon
          geometry.coordinates.forEach((polygon, polygonIndex) => {
  
            polygon.forEach((ring, ringIndex) => {
  
              graphics.beginFill(hexColor, 0.6); // Add fill color with transparency
              ring.forEach(([x, y], pointIndex) => {
                const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
                const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
  

  
                if (pointIndex === 0) {
                  graphics.moveTo(screenPoint.x, screenPoint.y);
                } else {
                  graphics.lineTo(screenPoint.x, screenPoint.y);
                }
              });
  
              graphics.closePath();
              graphics.endFill(); // Close the fill
            });
          });
        } else if (geometry.type === "Point" || geometry.type === "MultiPoint") {
          // Draw points
          geometry.coordinates.forEach(([x, y]) => {
            const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
            const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
  
            graphics.beginFill(hexColor);
            graphics.drawCircle(screenPoint.x, screenPoint.y, 4); // Adjust radius as needed
            graphics.endFill();
          });
        } else {
          console.warn(`Unsupported geometry type: ${geometry.type}`);
        }
  
        // Add graphics to the stage
        pixiAppRef.current.stage.addChild(graphics);
        hideLoadingSpinner();
      });
    });
  
    pixiAppRef.current.renderer.render(pixiAppRef.current.stage);
  };
  
  
  
  
  
  

  const throttle = (func, limit) => {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  };
  
  const handlePanZoomEnd = async () => {
    setLoadingStatus(false);
    const currentZoom = viewer ? viewer.viewport.getZoom() : 0;
  
    if (currentZoom <= 7) {
      setNotification('Zoom in to load annotations.');
      return;
    }
    else{
      setNotification('Loading Annotations...');
    }
  
    const bounds = getViewportBounds();
    if (!bounds || !selectedImage) return;
  
    removeBlur();
  
    try {
      const annotationsByFile = await fetchNormalizedAnnotations(bounds, selectedImage);
      setAnnotations((prevAnnotations) => {
        const uniqueAnnotations = new Map(prevAnnotations.map((a) => [a.id, a]));
  
        Object.entries(annotationsByFile).forEach(([filename, annotationGroup]) => {
          annotationGroup.forEach((annotation) => {
            uniqueAnnotations.set(annotation.id, annotation);
          });
        });
        return Array.from(uniqueAnnotations.values());
      });
      setNotification(''); // Clear notification if annotations are found
      drawAnnotationsWithPixi();
    } catch (error) {
      console.error("Error during pan/zoom end handling:", error);
    }
  };
  
  
  function clearGraphics()
  {
    const graphics = annotationGraphicsRef.current;
    if(graphics)
    {graphics.clear(); 
    }
  }

  useEffect(() => {
    if (viewer) {
      const updateZoomValue = () => {
        const currentZoom = viewer.viewport.getZoom();
        setZoomValue(currentZoom);
      };
  
      viewer.addHandler('zoom', updateZoomValue);
      viewer.addHandler('animation', updateZoomValue);
      viewer.addHandler('animation', clearGraphics);
      viewer.addHandler('zoom', clearGraphics);
      viewer.addHandler('pan', clearGraphics);
      viewer.addHandler('animation-finish', updateZoomValue);
      viewer.addHandler('animation-finish', hideLoadingSpinner);
  
      return () => {
        viewer.removeHandler('zoom', updateZoomValue);
        viewer.removeHandler('animation', updateZoomValue);
        viewer.removeHandler('animation', clearGraphics);
        viewer.removeHandler('zoom', clearGraphics);
        viewer.removeHandler('pan', clearGraphics);
        viewer.removeHandler('animation-finish', updateZoomValue);
      };
    }
  }, [viewer]);

  const [loadingStatus, setLoadingStatus] = useState("");
  useEffect(() => {
    const initialVisibility = {};
    Object.entries(annotationsByFile).forEach(([filename, annotationGroup]) => {
      initialVisibility[filename] = {};
      annotationGroup.forEach(({ properties }) => {
        const type = properties.classification.name;
        initialVisibility[filename][type] = false; 
      });
    });
    setVisibleAnnotations(initialVisibility);
  }, [annotationsByFile]);
  
  
  const handleToggleAnnotation = (filename, type) => {
    setVisibleAnnotations((prevState) => ({
      ...prevState,
      [filename]: {
        ...prevState[filename],
        [type]: !(prevState[filename]?.[type] || false), // Toggle visibility
      },
    }));
  };
  
  useEffect(() => {
    if (viewer) {
      viewer.destroy(); // Destroy the existing viewer instance
      setViewer(null); // Clear the viewer state to prepare for reinitialization
    }
  
    if (viewerRef.current) {
      const newViewer = OpenSeadragon({
        element: viewerRef.current,
        tileSources: currentDziUrl, // Use the current DZI URL
        showNavigationControl: false,
        maxZoomPixelRatio: 15,
        minZoomImageRatio: 1,
        minZoomLevel: 1,
        visibilityRatio: 1.0,
        constrainDuringPan: true,
      });
  
      newViewer.addHandler('open', () => {
        setViewer(newViewer); // Save the new viewer instance in state
        newViewer.viewport.zoomTo(1);
        setZoomValue(newViewer.viewport.getZoom());
        initializePixiApp();
      });
  
      newViewer.addHandler('animation-start', handlePanZoomStart);
      newViewer.addHandler('animation-finish', handlePanZoomEnd);
  
      return () => {
        newViewer.destroy(); // Clean up on component unmount or re-render
      };
    }
  }, [currentDziUrl]); // Re-run the effect whenever the DZI URL changes
  
  useEffect(() => {
    if (annotations.length > 0) {
      drawAnnotationsWithPixi();
    }
  }, [visibleAnnotations, annotations, zoomValue, loadingStatus, linkedAnnotations]);
  

  const handleZoomChange = (event) => {
    const zoomLevel = parseFloat(event.target.value);
    if (viewer) {
      viewer.viewport.zoomTo(zoomLevel);
    }
  };
  let animationFrameId = null;

const handlePanZoom = () => {
  if (animationFrameId) {
  }
  animationFrameId = requestAnimationFrame(() => {
    drawAnnotationsWithPixi();
    animationFrameId = null;
  });
};

useEffect(() => {
  if (viewer) {
    viewer.addHandler('pan', handlePanZoom);
    viewer.addHandler('zoom', handlePanZoom);
    viewer.addHandler('animation', handlePanZoom);
    viewer.addHandler('animation-start', handlePanZoomStart); 
    viewer.addHandler('animation-finish', handlePanZoomEnd);  

    return () => {
      viewer.removeHandler('pan', handlePanZoom);
      viewer.removeHandler('zoom', handlePanZoom);
      viewer.removeHandler('animation', handlePanZoom);
      viewer.removeHandler('animation-start', handlePanZoomStart); 
      viewer.removeHandler('animation-finish', handlePanZoomEnd); 
    };
  }
}, [viewer, annotations, visibleAnnotations]);


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
  const dziFilenameWithoutExtension = selectedImage.replace('.dzi', '');
  const formData = new FormData();
  formData.append('file', file);
  formData.append('dziFile', dziFilenameWithoutExtension);


  try {
    await axios.post(`${process.env.REACT_APP_BACKEND_URL}/link_annotation_to_dzi`, formData);
    alert(`Successfully uploaded annotation ${file.name}`);
  } catch (error) {
    console.error('Error uploading annotation file:', error);
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

  setAnnotationFiles([]); // Clear state
  document.querySelector('input[type="file"]').value = ''; // Clear file input
};



  return (
    <div className="viewer-container">
      <div className="viewer-header">
        <h1>Whole Slide Image Viewer</h1>
      </div>
       <div className="dropdown-container">
        <label>Select an Available Image:</label>
        <select onChange={handleImageChange}>
          <option value="" disabled selected>Select an image</option>
          {availableImages.map((image) => (
            <option key={image} value={image}>
              {image}
            </option>
          ))}
        </select>
      </div>
      <div className="viewer-wrapper">
        <div className="viewer-box">
         {notification!=='' && <div className="loading-spinner" id="loadingSpinner"></div>}
          <div id="openseadragon-viewer" ref={viewerRef} className="wsi-viewer">
          </div>
          <div className="annotation-legend">
            
          <ul>
  {annotationTypes.map((type) => {
    let color = null;

    for (const annotation of annotations) {
      const features = annotation.features || []; // Default to an empty array if `features` is undefined
      const feature = features.find((feature) => feature.properties.classification.name === type);

      if (feature) {
        color = feature.properties.classification.color;
        break;
      }
    }

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
            <div className="annotation-toggles">
  <h3>Toggle Annotations</h3>{notification && <div><p style={{color:"Orange", fontWeight:"Bold"}}>Current Status: </p><p>{notification}</p></div>}
  {Object.entries(annotationsByFile).map(([filename, annotationGroup]) => (
    <div key={filename}>
      <h4>{filename.replace('.json', '')}</h4>
      {annotationGroup.map(({ properties }, index) => (
        <div key={index}>
          <label>
            <input
              type="checkbox"
              checked={visibleAnnotations[filename]?.[properties.classification.name] || false}
              onChange={() => handleToggleAnnotation(filename, properties.classification.name)}
            />
            {properties.classification.name}
          </label>
        </div>
      ))}
    </div>
  ))}
</div>





        </div>
      </div>

      <div className="zoom-slider-container">
        Zoom Level
      <input
          id="zoomSlider"
          className="zoom-slider"
          type="range"
          min={1}
          max={10}
          step={1}
          value={Math.min(zoomValue, 10)}
          onChange={handleZoomChange}
        />
          <div className="zoom-levels">
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i + 1} className="zoom-level">{i + 1}</span>
          ))}
                </div>
      </div>
      <div className="upload-section">
        <input type="file" onChange={handleAnnotationFileChange} accept=".json,.geojson" multiple />
        <button onClick={handleMultipleAnnotationUpload} className="upload-btn">
          Upload Annotations
        </button>
      </div>
      {linkedAnnotations.length > 0 && (
        <div className="linked-annotations-section">
          <h3>Linked Annotations for DZI: {filename}</h3>
          <ul>
            {linkedAnnotations.map((annotation, index) => (
              <li key={index}>
                <span>{annotation.filename}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default Viewer;