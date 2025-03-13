// Video Resizer UI Scripts

// Copy to clipboard function
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
function copyToClipboard(elementId) {
  const element = document.getElementById(elementId);
  const text = element.textContent;
  
  navigator.clipboard.writeText(text).then(() => {
    // Create and show a temporary tooltip
    const button = element.nextElementSibling;
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    
    setTimeout(() => {
      button.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy text: ', err);
  });
}

// Initialize tooltips
document.addEventListener('DOMContentLoaded', function() {
  // Example URL generator
  const urlBuilder = document.getElementById('url-builder-form');
  const urlOutput = document.getElementById('url-output');
  
  if (urlBuilder) {
    urlBuilder.addEventListener('submit', function(e) {
      e.preventDefault();
      
      const formData = new FormData(urlBuilder);
      let baseUrl = 'https://cdn.erfi.dev/videos/sample.mp4';
      const params = new URLSearchParams();
      
      // Add parameters from form
      for (const [key, value] of formData.entries()) {
        if (value && value !== 'auto' && value !== '0') {
          params.append(key, value);
        }
      }
      
      // Generate output URL
      const queryString = params.toString();
      const outputUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl;
      
      if (urlOutput) {
        urlOutput.textContent = outputUrl;
      }
    });
  }
  
  // Feature detection
  const features = {
    mediaCapabilities: 'mediaCapabilities' in navigator,
    serviceWorker: 'serviceWorker' in navigator,
    pictureInPicture: document.pictureInPictureEnabled,
    mediaSession: 'mediaSession' in navigator
  };
  
  // Display detected features
  const featuresList = document.getElementById('features-detection');
  if (featuresList) {
    for (const [feature, supported] of Object.entries(features)) {
      const listItem = document.createElement('li');
      listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
      
      listItem.innerHTML = `
        ${feature.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
        <span class="badge bg-${supported ? 'success' : 'secondary'} rounded-pill">
          ${supported ? 'Supported' : 'Not Supported'}
        </span>
      `;
      
      featuresList.appendChild(listItem);
    }
  }
});