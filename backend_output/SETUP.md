# Rebel Engine Backend — Quick Start

## 1. Install dependencies
```bash
npm install
```

## 2. Configure environment
Copy `.env` and fill in your values:
```
MONGODB_URI=mongodb://localhost:27017/merchant-hub
JWT_SECRET=change_this_to_a_long_random_string
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:5000
```

## 3. Seed a client (first time only)
```bash
node scripts/seedClients.js
```

## 4. Create owner user
```bash
node scripts/makeOwner.js
```

## 5. Start server
```bash
npm run dev       # development (nodemon)
npm start         # production
```

## 6. Dashboard login
Open: http://localhost:5000/client-dashboard.html
- Enter your Store ID (clientId)
- Login with owner credentials

## API Base
All endpoints: `http://localhost:5000/api/v1/`

## STORE_CONFIG.js (frontend)
Set `clientId` and `apiBase` to point at your running backend.
```js
clientId: 'your-client-id',
apiBase:  'http://localhost:5000/api/v1'
```
