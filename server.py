#!/usr/bin/env python3
"""
Simple local development server with .env support.
Reads variables from .env and serves index.html and admin.html.
Injects window.__FIREBASE_CONFIG__ dynamically if requested via /firebase-env.js.
"""

import http.server
import json
import os
import socketserver
import sys

PORT = int(os.environ.get("PORT", 8000))

def load_env(env_path=".env"):
    config = {}
    if not os.path.exists(env_path):
        return config
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            config[k] = v
    return config

class EnvHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/firebase-env.js":
            env_vars = load_env()
            # Map standard env vars to firebaseConfig
            fb_config = {
                "apiKey": env_vars.get("VITE_FIREBASE_API_KEY", env_vars.get("FIREBASE_API_KEY", "")),
                "authDomain": env_vars.get("VITE_FIREBASE_AUTH_DOMAIN", env_vars.get("FIREBASE_AUTH_DOMAIN", "")),
                "databaseURL": env_vars.get("VITE_FIREBASE_DATABASE_URL", env_vars.get("FIREBASE_DATABASE_URL", "")),
                "projectId": env_vars.get("VITE_FIREBASE_PROJECT_ID", env_vars.get("FIREBASE_PROJECT_ID", "")),
                "storageBucket": env_vars.get("VITE_FIREBASE_STORAGE_BUCKET", env_vars.get("FIREBASE_STORAGE_BUCKET", "")),
                "messagingSenderId": env_vars.get("VITE_FIREBASE_MESSAGING_SENDER_ID", env_vars.get("FIREBASE_MESSAGING_SENDER_ID", "")),
                "appId": env_vars.get("VITE_FIREBASE_APP_ID", env_vars.get("FIREBASE_APP_ID", "")),
                "measurementId": env_vars.get("VITE_FIREBASE_MEASUREMENT_ID", env_vars.get("FIREBASE_MEASUREMENT_ID", ""))
            }
            content = f"window.__FIREBASE_CONFIG__ = {json.dumps(fb_config, indent=2)};\n".encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        super().do_GET()

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), EnvHTTPHandler) as httpd:
        print(f"==================================================")
        print(f" Chakravyuh Trading Game Server running on port {PORT}")
        print(f" Student Portal: http://localhost:{PORT}/index.html")
        print(f" Judge Console:  http://localhost:{PORT}/admin.html")
        print(f"==================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")

if __name__ == "__main__":
    main()
