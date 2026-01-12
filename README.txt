MCB Site Manager (Full) - PWA

1) Run locally (recommended):
   - In this folder, run:
       python3 -m http.server 8080
   - Open:
       http://localhost:8080

2) Install as an app:
   - On iPhone Safari: Share -> Add to Home Screen
   - On Android Chrome: Install app / Add to Home screen

Notes:
- Data is stored locally on this device (localStorage). Use Export/Import in the header to back up.
- Logo is loaded from the root file: ./logo.png
- Live Map uses OpenStreetMap embed. Geocoding uses Nominatim (online). If geocode fails, address still works.
- Waze Drive button uses deep links: waze.com/ul


Patch: Import now persists to IndexedDB; modal action buttons forced to type='button'; diary tap opens read-only view.
