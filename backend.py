from flask import Flask, request, jsonify
from pymongo import MongoClient
from datetime import datetime
import os
from bson import ObjectId
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

MONGO_URI = os.getenv("MONGO_URI")
client = MongoClient(MONGO_URI)
db = client.test
users = db.users


# --- LOGIN (create new session for the user) ---
@app.route("/login", methods=["POST"])
def login():
    data = request.json
    username = data.get("username")
    password = data.get("password")

    user = users.find_one({"username": username, "password": password})
    if not user:
        return jsonify({"success": False}), 401

    # build a new session
    session = {
        "_id": ObjectId(),  # unique session ID
        "starttime": datetime.utcnow(),
        "endtime": None,
        "duration": None,  # add duration field
        "videos": [],
        "inactivity": [],
    }

    users.update_one({"_id": user["_id"]}, {"$push": {"sessions": session}})

    return jsonify({"success": True, "session_id": str(session["_id"])})


# --- LOGOUT (set endtime + duration on last session) ---
@app.route("/logout", methods=["POST"])
def logout():
    data = request.json
    session_id = data.get("session_id")
    if not session_id:
        return jsonify({"success": False, "error": "Missing session_id"}), 400

    try:
        oid = ObjectId(session_id)
    except Exception:
        return jsonify({"success": False, "error": "Invalid session_id"}), 400

    # get session starttime first
    user = users.find_one({"sessions._id": oid}, {"sessions.$": 1})
    if not user or "sessions" not in user or len(user["sessions"]) == 0:
        return jsonify({"success": False, "error": "Session not found"}), 404

    session = user["sessions"][0]
    starttime = session.get("starttime")
    endtime = datetime.utcnow()
    duration = None
    if starttime:
        duration = (endtime - starttime).total_seconds()

    users.update_one(
        {"sessions._id": oid},
        {"$set": {"sessions.$.endtime": endtime, "sessions.$.duration": duration}},
    )

    return jsonify(
        {"success": True, "endtime": endtime.isoformat(), "duration": duration}
    )


# --- LOG VIDEO (push into correct user's session) ---
@app.route("/log_video", methods=["POST"])
def log_video():
    data = request.json
    session_id = data.get("session_id")
    if not session_id:
        return jsonify({"success": False, "error": "Missing session_id"}), 400

    try:
        oid = ObjectId(session_id)
    except Exception:
        return jsonify({"success": False, "error": "Invalid session_id"}), 400

    video_entry = {
        "videoId": data.get("videoId"),
        "duration": data.get("duration"),
        "watched": data.get("watched"),
        "status": data.get("status"),
        "keys": data.get("keys", []),
    }

    result = users.update_one(
        {"sessions._id": oid}, {"$push": {"sessions.$.videos": video_entry}}
    )

    if result.modified_count == 0:
        return jsonify({"success": False, "error": "Session not found"}), 404

    return jsonify({"success": True, "video": video_entry})


# --- LOG INACTIVITY (push inactivity events into session) ---
@app.route("/log_inactivity", methods=["POST"])
def log_inactivity():
    data = request.json
    session_id = data.get("session_id")
    if not session_id:
        return jsonify({"success": False, "error": "Missing session_id"}), 400

    try:
        oid = ObjectId(session_id)
    except Exception:
        return jsonify({"success": False, "error": "Invalid session_id"}), 400

    inactivity_entry = {
        "starttime": data.get("starttime"),
        "endtime": data.get("endtime"),
        "duration": data.get("duration"),
        "type": data.get("type"),
    }

    result = users.update_one(
        {"sessions._id": oid}, {"$push": {"sessions.$.inactivity": inactivity_entry}}
    )

    if result.modified_count == 0:
        return jsonify({"success": False, "error": "Session not found"}), 404

    return jsonify({"success": True, "inactivity": inactivity_entry})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
