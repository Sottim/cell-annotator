/* eslint-disable no-restricted-globals */

// annotationWorker.js
self.onmessage = function (e) {
  const { annotations, bounds, imageSize, batchSize = 100 } = e.data;
  let index = 0;
  const filteredAnnotations = [];

  const processBatch = () => {
    const batch = annotations.slice(index, index + batchSize);
    batch.forEach(feature => {
      if (feature.geometry.coordinates.some(point => {
        const [x, y] = point;
        const scaledX = x / imageSize.x;
        const scaledY = y / imageSize.y;
        return (
          scaledX >= bounds.x && 
          scaledX <= bounds.x + bounds.width &&
          scaledY >= bounds.y && 
          scaledY <= bounds.y + bounds.height
        );
      })) {
        filteredAnnotations.push(feature);
      }
    });
    
    index += batchSize;

    if (index < annotations.length) {
      setTimeout(processBatch, 0); // Process next batch
    } else {
      self.postMessage(filteredAnnotations); // Send all filtered annotations after processing
    }
  };

  processBatch();
};
