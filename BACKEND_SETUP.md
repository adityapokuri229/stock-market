# Chakravyuh Backend Setup Guidelines

This document outlines the steps to set up and configure the backend components for the Chakravyuh Trading Game. The backend consists of two main parts:
1. **The Python Market Engine (`market_engine.py`)**: Responsible for generating the deterministic tick-by-tick dataset (`game_data.json`).
2. **The Firebase Realtime Database**: Responsible for tracking live trades and synchronizing them to the Judge Console.

---

## 1. Python Market Engine Setup (OPTIONAL)

*Note: You do NOT need to run this script for your event. A complete `game_data.json` has already been generated and is included in the folder. You only need to run this if you want to generate a completely new, randomized market scenario in the future.*

The `market_engine.py` script uses a geometric Brownian motion model with shocks to generate the market data. 

### Prerequisites
- Python 3.8 or higher installed on your system.
- `numpy` library installed.

### Steps
1. Open your terminal or command prompt.
2. Navigate to the project directory:
   ```bash
   cd path/to/your/project
   ```
3. Install the required dependencies:
   ```bash
   pip install numpy
   ```
4. Run the market engine script:
   ```bash
   python market_engine.py
   ```
5. **Result**: The script will output a success message and create a `game_data.json` file in the same directory. This file is read by both the main web app (`app.js`) and the judge console (`admin.js`).

> **Note**: Whenever you want a new scenario (different random seed or different base prices), you can run the script again to overwrite `game_data.json`. Otherwise, just use the provided file!

---

## 2. Firebase Database Setup

To make the game "Live" and allow the Judge Console to receive trades in real-time, you must configure a Firebase project.

### Step 1: Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project**.
3. Name it (e.g., `Chakravyuh-Game`), accept the terms, and disable Google Analytics (not needed).
4. Click **Create project** and wait for it to finish.

### Step 2: Enable Anonymous Authentication
Because teams don't have traditional email/password accounts on the backend (they use the hardcoded `app.js` passwords), we use Anonymous Auth to allow the web app to write to the database.
1. In the left sidebar, click **Build** -> **Authentication**.
2. Click **Get Started**.
3. Go to the **Sign-in method** tab.
4. Under "Native providers", click **Anonymous** and toggle it to **Enable**.
5. Click **Save**.

### Step 3: Create the Realtime Database
1. In the left sidebar, click **Build** -> **Realtime Database**.
2. Click **Create Database**.
3. Choose a location (e.g., Singapore or US) and click **Next**.
4. Select **Start in test mode** (this allows reads/writes temporarily, which is fine for a closed network/event).
5. Click **Enable**.

### Step 4: Configure Database Rules (Optional but Recommended)
To prevent unauthorized access outside of the event, go to the **Rules** tab in the Realtime Database and use this configuration:
```json
{
  "rules": {
    ".read": true,
    ".write": "auth != null"
  }
}
```
*This means anyone can read the leaderboard, but only the app (which anonymously authenticates) can write trades.*

---

## 3. Integrating Firebase into the Game

### Getting the Config
1. Go back to your Firebase Project Overview (click the gear icon -> **Project settings**).
2. Scroll down to the "Your apps" section and click the **`</>`** (Web) icon.
3. Give the app a nickname (e.g., `Chakravyuh-Web`) and click **Register app**.
4. You will see a `firebaseConfig` object that looks like this:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSyXXXXXXX...",
     authDomain: "chakravyuh-game.firebaseapp.com",
     projectId: "chakravyuh-game",
     storageBucket: "chakravyuh-game.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```
5. Copy this object.

### Updating `firebase-glue.js`
1. Open `firebase-glue.js` in your code editor.
2. Locate the placeholder `firebaseConfig` object at the top of the file.
3. Replace it entirely with the config you copied from Firebase.
4. Save the file.

---

## 4. Running the Application Locally

Modern browsers block loading local JSON files (like `game_data.json`) and ES modules (like `firebase-glue.js`) directly from the file system (`file:///C:/...`) due to CORS (Cross-Origin Resource Sharing) policies.

**You must serve the folder using a local web server.**

### Using Python (Recommended)
1. Open your terminal in the project directory.
2. Run the following command:
   ```bash
   python -m http.server 8000
   ```
3. Open your browser and go to:
   - **Student Interface**: `http://localhost:8000/index.html`
   - **Judge Console**: `http://localhost:8000/admin.html`

### Using VS Code Live Server
If you use Visual Studio Code:
1. Install the **Live Server** extension by Ritwick Dey.
2. Open the project folder in VS Code.
3. Right-click on `index.html` and select **"Open with Live Server"**.

---

## 5. Offline Fallback Strategy
If the internet goes down or Firebase is not configured:
1. The game will still function perfectly for the students locally in their browser.
2. At the end of the game, `app.js` will automatically prompt the browser to download a JSON file (e.g., `chakravyuh_bundle_alpha_1234.json`).
3. The Judges can go to the Judge Console, click **Offline Load (JSON)**, and upload this file to manually score the team.
