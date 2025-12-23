# update_production.ps1
Write-Host "🚀 Deploying Qognus Platform..." -ForegroundColor Cyan

# 1. Get latest code
git pull origin main

# 2. Re-install dependencies (if any)
npm install

# 3. Restart the Python Server (Optional, usually not needed for static files but good practice)
# (If you are just serving files, a refresh in the browser is actually enough!)

Write-Host "✅ Deployment Complete. Refresh your browser." -ForegroundColor Green