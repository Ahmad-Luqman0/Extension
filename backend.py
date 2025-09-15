from flask import Flask, request, jsonify
from pymongo import MongoClient
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Allow cross-origin for extension

client = MongoClient("mongodb+srv://admin:ahmad@cluster0.oyvzkiz.mongodb.net/test")
db = client.test  # Use your test DB
users = db.users


@app.route("/login", methods=["POST"])
def login():
    data = request.json
    username = data.get("username")
    password = data.get("password")
    if users.find_one({"username": username, "password": password}):
        return jsonify({"success": True})
    else:
        return jsonify({"success": False})


if __name__ == "__main__":
    app.run(port=8000)
