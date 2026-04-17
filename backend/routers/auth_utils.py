import os
import jwt
from typing import Optional
from fastapi import Header, HTTPException, Depends
from firebase_admin import auth
from backend.services.firestore import get_db

def verify_firebase_token(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token format")
    token = authorization.split("Bearer ")[1]
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token validation failed: {str(e)}")

def verify_admin_token(authorization: Optional[str] = Header(None)):
    decoded_token = verify_firebase_token(authorization)
    email = decoded_token.get('email')
    
    if not email:
        raise HTTPException(status_code=403, detail="No email associated with token")
        
    db = get_db()
    # Ensure they are an admin
    admin_doc = db.collection('admins').where('email', '==', email).limit(1).stream()
    has_admin = False
    for doc in admin_doc:
        has_admin = True
    
    fallback_emails = os.getenv("ADMIN_EMAILS", "").split(",")
    if not has_admin and email not in fallback_emails:
        raise HTTPException(status_code=403, detail="User is not authorized as an organiser")
        
    return decoded_token

def verify_staff_token(staff_token: str):
    secret = os.getenv("STAFF_TOKEN_SECRET", "default_staff_secret")
    try:
        payload = jwt.decode(staff_token, secret, algorithms=["HS256"])
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired staff token")
