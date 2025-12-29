import * as cornerstone from 'cornerstone-core';
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import * as dicomParser from 'dicom-parser';

// Initialize cornerstone and WADO image loader
cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

// Configure WADO Image Loader
cornerstoneWADOImageLoader.configure({
  useWebWorkers: true,
  decodeConfig: {
    convertFloatPixelDataToInt: false
  }
});

let maxWebWorkers = 1;

if (navigator.hardwareConcurrency) {
  maxWebWorkers = Math.min(navigator.hardwareConcurrency, 7);
}

const config = {
  maxWebWorkers,
  startWebWorkersOnDemand: false,
  taskConfiguration: {
    decodeTask: {
      initializeCodecsOnStartup: false,
      strict: false
    }
  }
};

cornerstoneWADOImageLoader.webWorkerManager.initialize(config);

export { cornerstone, cornerstoneWADOImageLoader, dicomParser };

export function initializeCornerstone() {
  return cornerstone;
}

// Load DICOM image from file
export async function loadDicomFromFile(file) {
  return new Promise((resolve, reject) => {
    const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(file);
    
    cornerstone.loadImage(imageId).then(image => {
      resolve({ imageId, image });
    }).catch(error => {
      reject(error);
    });
  });
}

// Parse DICOM file metadata
export async function parseDicomMetadata(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target.result;
        const byteArray = new Uint8Array(arrayBuffer);
        const dataSet = dicomParser.parseDicom(byteArray);
        
        // Extract common DICOM tags
        const metadata = {
          patientName: getString(dataSet, 'x00100010'),
          patientID: getString(dataSet, 'x00100020'),
          studyDate: getString(dataSet, 'x00080020'),
          studyDescription: getString(dataSet, 'x00081030'),
          seriesDescription: getString(dataSet, 'x0008103e'),
          instanceNumber: getString(dataSet, 'x00200013'),
          sliceLocation: getString(dataSet, 'x00201041'),
          rows: getNumber(dataSet, 'x00280010'),
          columns: getNumber(dataSet, 'x00280011'),
        };
        
        resolve(metadata);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

// Helper function to get string from DICOM dataset
function getString(dataSet, tag) {
  try {
    const element = dataSet.elements[tag];
    if (element) {
      return dataSet.string(tag);
    }
  } catch (e) {
    return '';
  }
  return '';
}

// Helper function to get number from DICOM dataset
function getNumber(dataSet, tag) {
  try {
    const element = dataSet.elements[tag];
    if (element) {
      return dataSet.intString(tag);
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Display DICOM image in a canvas element
export function displayDicomImage(element, imageId) {
  cornerstone.enable(element);
  
  return cornerstone.loadAndCacheImage(imageId).then(image => {
    cornerstone.displayImage(element, image);
    return image;
  });
}

// Enable/disable specific tools
export function enableImageTools(element) {
  // Add mouse wheel zoom
  element.addEventListener('wheel', (e) => {
    e.preventDefault();
    const viewport = cornerstone.getViewport(element);
    if (viewport) {
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      viewport.scale += delta;
      cornerstone.setViewport(element, viewport);
    }
  });
  
  // Add window level adjustment
  let isMouseDown = false;
  let startX, startY;
  
  element.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Left click
      isMouseDown = true;
      startX = e.clientX;
      startY = e.clientY;
    }
  });
  
  element.addEventListener('mousemove', (e) => {
    if (isMouseDown) {
      const viewport = cornerstone.getViewport(element);
      if (viewport) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        viewport.voi.windowWidth += deltaX;
        viewport.voi.windowCenter += deltaY;
        
        cornerstone.setViewport(element, viewport);
        
        startX = e.clientX;
        startY = e.clientY;
      }
    }
  });
  
  element.addEventListener('mouseup', () => {
    isMouseDown = false;
  });
  
  element.addEventListener('mouseleave', () => {
    isMouseDown = false;
  });
}

// Reset viewport to default
export function resetViewport(element) {
  const enabledElement = cornerstone.getEnabledElement(element);
  if (enabledElement) {
    const viewport = cornerstone.getDefaultViewportForImage(enabledElement.element, enabledElement.image);
    cornerstone.setViewport(element, viewport);
  }
}
