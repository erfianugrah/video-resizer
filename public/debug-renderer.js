/**
 * Debug Renderer - Client-side script to render debug information
 */

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', function() {
  // Update the current time display
  function updateCurrentTime() {
    const timeElement = document.getElementById('current-time');
    if (timeElement) {
      timeElement.textContent = new Date().toLocaleString();
    }
  }
  
  // Render the diagnostic data into HTML
  function renderDebugData() {
    // Get diagnostic data from global variable
    const diagnosticsInfo = window.DIAGNOSTICS_DATA || {};
    if (!diagnosticsInfo) {
      showError('No diagnostic data available');
      return;
    }
    
    const debugContent = document.getElementById('debug-content');
    if (!debugContent) return;
    
    // Clear any existing content
    debugContent.innerHTML = '';
    
    // Create overview cards
    const overviewRow = createOverviewCards(diagnosticsInfo);
    debugContent.appendChild(overviewRow);
    
    // Create main content row
    const contentRow = document.createElement('div');
    contentRow.className = 'row';
    
    // Left column - 8 cols
    const leftCol = document.createElement('div');
    leftCol.className = 'col-lg-8';
    
    // Add processing card
    leftCol.appendChild(createProcessingCard(diagnosticsInfo));
    
    // Add client detection card
    leftCol.appendChild(createClientDetectionCard(diagnosticsInfo));
    
    // Add transform parameters if available
    if (diagnosticsInfo.transformParams) {
      leftCol.appendChild(createTransformParamsCard(diagnosticsInfo.transformParams));
    }
    
    // Right column - 4 cols
    const rightCol = document.createElement('div');
    rightCol.className = 'col-lg-4';
    
    // Add cache info card
    rightCol.appendChild(createCacheCard(diagnosticsInfo));
    
    // Add errors and warnings if available
    if ((diagnosticsInfo.errors && diagnosticsInfo.errors.length > 0) || 
        (diagnosticsInfo.warnings && diagnosticsInfo.warnings.length > 0)) {
      rightCol.appendChild(createErrorsWarningsCard(diagnosticsInfo));
    }
    
    // Add browser capabilities if available
    if (diagnosticsInfo.browserCapabilities) {
      rightCol.appendChild(createBrowserCapabilitiesCard(diagnosticsInfo.browserCapabilities));
    }
    
    // Add columns to row
    contentRow.appendChild(leftCol);
    contentRow.appendChild(rightCol);
    
    // Add row to content
    debugContent.appendChild(contentRow);
    
    // Add animation classes
    setTimeout(() => {
      const elements = document.querySelectorAll('.card');
      elements.forEach((el, i) => {
        el.classList.add('fade-in');
        el.classList.add(`delay-${i % 5 + 1}`);
      });
    }, 100);
  }
  
  // Helper Functions for Creating UI Components
  
  function createOverviewCards(data) {
    const row = document.createElement('div');
    row.className = 'row mb-4';
    
    // Processing Time Card
    const timeCard = createCard(
      'speedometer2',
      'Processing Time',
      `<p class="text-muted mb-2">Video processing completed in:</p>
       <h3 class="text-primary">${data.processingTimeMs || 0} ms</h3>`
    );
    timeCard.className = 'col-md-4';
    row.appendChild(timeCard);
    
    // Device Detection Card
    const deviceCard = createCard(
      'device-hdd',
      'Device Detection',
      `<p class="text-muted mb-2">Client device detected as:</p>
       <h3 class="text-primary">${data.deviceType || 'Unknown'}</h3>`
    );
    deviceCard.className = 'col-md-4';
    row.appendChild(deviceCard);
    
    // Cache Status Card
    const cacheCard = createCard(
      'hdd-stack',
      'Cache Status',
      `<p class="text-muted mb-2">Content caching:</p>
       <h3 class="${data.cacheability ? 'text-success' : 'text-warning'}">
         ${data.cacheability ? 'Enabled' : 'Disabled'}
       </h3>`
    );
    cacheCard.className = 'col-md-4';
    row.appendChild(cacheCard);
    
    return row;
  }
  
  function createProcessingCard(data) {
    const card = document.createElement('div');
    card.className = 'card mb-3';
    
    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = '<i class="bi bi-arrow-repeat"></i> Request Processing';
    card.appendChild(header);
    
    const body = document.createElement('div');
    body.className = 'card-body p-0';
    
    // Add info rows
    body.appendChild(createInfoRow('Processing Time:', 
      `<span class="badge badge-blue badge-value">
         <i class="bi bi-hourglass-split"></i> ${data.processingTimeMs || 0} ms
       </span>`
    ));
    
    if (data.transformSource) {
      body.appendChild(createInfoRow('Transform Source:', 
        `<span class="badge badge-purple badge-value">
           <i class="bi bi-shuffle"></i> ${data.transformSource}
         </span>`
      ));
    }
    
    if (data.pathMatch) {
      body.appendChild(createInfoRow('Path Pattern Match:', 
        `<code>${data.pathMatch}</code>`
      ));
    }
    
    if (data.videoId) {
      body.appendChild(createInfoRow('Video ID:', 
        `<span class="badge badge-blue badge-value">
           <i class="bi bi-camera-video"></i> ${data.videoId}
         </span>`
      ));
    }
    
    card.appendChild(body);
    return card;
  }
  
  function createClientDetectionCard(data) {
    const card = document.createElement('div');
    card.className = 'card mb-3';
    
    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = '<i class="bi bi-device-hdd"></i> Client Detection';
    card.appendChild(header);
    
    const body = document.createElement('div');
    body.className = 'card-body p-0';
    
    // Add client hints info
    body.appendChild(createInfoRow('Client Hints:', 
      data.clientHints 
        ? '<span class="badge badge-green badge-value"><i class="bi bi-check-circle"></i> Supported</span>' 
        : '<span class="badge badge-yellow badge-value"><i class="bi bi-exclamation-triangle"></i> Not supported</span>'
    ));
    
    if (data.deviceType) {
      const icon = data.deviceType === 'mobile' ? 'phone' : 
                   data.deviceType === 'tablet' ? 'tablet' : 'laptop';
                   
      body.appendChild(createInfoRow('Device Type:', 
        `<span class="badge badge-blue badge-value">
           <i class="bi bi-${icon}"></i> ${data.deviceType}
         </span>`
      ));
    }
    
    if (data.networkQuality) {
      const badgeColor = data.networkQuality === 'high' ? 'badge-green' : 
                        data.networkQuality === 'medium' ? 'badge-yellow' : 
                        'badge-red';
                        
      body.appendChild(createInfoRow('Network Quality:', 
        `<span class="badge ${badgeColor} badge-value">
           <i class="bi bi-wifi"></i> ${data.networkQuality}
         </span>`
      ));
    }
    
    card.appendChild(body);
    return card;
  }
  
  function createTransformParamsCard(params) {
    const card = document.createElement('div');
    card.className = 'card mb-3';
    
    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = '<i class="bi bi-sliders"></i> Transform Parameters';
    card.appendChild(header);
    
    const body = document.createElement('div');
    body.className = 'card-body';
    
    const tableResponsive = document.createElement('div');
    tableResponsive.className = 'table-responsive';
    
    const table = document.createElement('table');
    table.className = 'table table-hover';
    
    // Create header
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Parameter</th><th>Value</th></tr>';
    table.appendChild(thead);
    
    // Create body
    const tbody = document.createElement('tbody');
    
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><strong>${key}</strong></td>
          <td><code>${value}</code></td>
        `;
        tbody.appendChild(row);
      }
    }
    
    table.appendChild(tbody);
    tableResponsive.appendChild(table);
    body.appendChild(tableResponsive);
    card.appendChild(body);
    
    return card;
  }
  
  function createCacheCard(data) {
    const card = document.createElement('div');
    card.className = 'card mb-3';
    
    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = '<i class="bi bi-hdd-stack"></i> Caching';
    card.appendChild(header);
    
    const body = document.createElement('div');
    body.className = 'card-body p-0';
    
    // Add cacheability status
    body.appendChild(createInfoRow('Status:', 
      data.cacheability 
        ? '<span class="badge badge-green badge-value"><i class="bi bi-check-circle"></i> Enabled</span>' 
        : '<span class="badge badge-yellow badge-value"><i class="bi bi-x-circle"></i> Disabled</span>'
    ));
    
    // Add TTL if available
    if (data.cacheTtl !== undefined) {
      body.appendChild(createInfoRow('TTL:', 
        `<span class="badge badge-blue badge-value">
           <i class="bi bi-clock-history"></i> ${data.cacheTtl} seconds
         </span>`
      ));
    }
    
    card.appendChild(body);
    return card;
  }
  
  function createErrorsWarningsCard(data) {
    const card = document.createElement('div');
    card.className = 'card mb-3';
    
    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = '<i class="bi bi-exclamation-diamond"></i> Errors & Warnings';
    card.appendChild(header);
    
    const body = document.createElement('div');
    body.className = 'card-body';
    
    // Add errors if any
    if (data.errors && data.errors.length > 0) {
      const errorsTitle = document.createElement('h6');
      errorsTitle.className = 'mb-2';
      errorsTitle.textContent = `Errors (${data.errors.length})`;
      body.appendChild(errorsTitle);
      
      const errorsList = document.createElement('ul');
      errorsList.className = 'errors-list list-unstyled';
      
      data.errors.forEach(error => {
        const item = document.createElement('li');
        item.innerHTML = `<i class="bi bi-exclamation-circle-fill me-2"></i> ${error}`;
        errorsList.appendChild(item);
      });
      
      body.appendChild(errorsList);
    }
    
    // Add warnings if any
    if (data.warnings && data.warnings.length > 0) {
      const warningsTitle = document.createElement('h6');
      warningsTitle.className = 'mb-2 mt-3';
      warningsTitle.textContent = `Warnings (${data.warnings.length})`;
      body.appendChild(warningsTitle);
      
      const warningsList = document.createElement('ul');
      warningsList.className = 'warnings-list list-unstyled';
      
      data.warnings.forEach(warning => {
        const item = document.createElement('li');
        item.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-2"></i> ${warning}`;
        warningsList.appendChild(item);
      });
      
      body.appendChild(warningsList);
    }
    
    card.appendChild(body);
    return card;
  }
  
  function createBrowserCapabilitiesCard(capabilities) {
    const card = document.createElement('div');
    card.className = 'card mb-3';
    
    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = '<i class="bi bi-browser-chrome"></i> Browser Capabilities';
    card.appendChild(header);
    
    const body = document.createElement('div');
    body.className = 'card-body p-0';
    
    for (const [key, value] of Object.entries(capabilities)) {
      body.appendChild(createInfoRow(key + ':', 
        value ? 
          '<span class="badge badge-green">Yes</span>' : 
          '<span class="badge badge-red">No</span>'
      ));
    }
    
    card.appendChild(body);
    return card;
  }
  
  // Helper function to create a card div
  function createCard(icon, title, content) {
    const col = document.createElement('div');
    
    const card = document.createElement('div');
    card.className = 'card feature-card h-100';
    
    const cardBody = document.createElement('div');
    cardBody.className = 'card-body';
    
    const iconDiv = document.createElement('div');
    iconDiv.className = 'feature-icon';
    iconDiv.innerHTML = `<i class="bi bi-${icon}"></i>`;
    
    const titleElem = document.createElement('h5');
    titleElem.textContent = title;
    
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = content;
    
    cardBody.appendChild(iconDiv);
    cardBody.appendChild(titleElem);
    cardBody.appendChild(contentDiv);
    card.appendChild(cardBody);
    col.appendChild(card);
    
    return col;
  }
  
  // Helper function to create an info row
  function createInfoRow(label, valueHtml) {
    const row = document.createElement('div');
    row.className = 'info-row';
    
    const labelDiv = document.createElement('div');
    labelDiv.className = 'info-label';
    labelDiv.textContent = label;
    
    const valueDiv = document.createElement('div');
    valueDiv.className = 'info-value';
    valueDiv.innerHTML = valueHtml;
    
    row.appendChild(labelDiv);
    row.appendChild(valueDiv);
    
    return row;
  }
  
  // Show error message
  function showError(message) {
    const debugContent = document.getElementById('debug-content');
    if (debugContent) {
      debugContent.innerHTML = `
        <div class="alert alert-danger">
          <h4><i class="bi bi-exclamation-triangle me-2"></i>Error</h4>
          <p>${message}</p>
        </div>
      `;
    }
  }
  
  // Initialize
  updateCurrentTime();
  setInterval(updateCurrentTime, 1000);
  renderDebugData();
});