#!/bin/bash
set -e

echo "Building and Pushing Docker container remotely (No local Docker needed!)..."
mv backend/Dockerfile Dockerfile
gcloud builds submit --tag gcr.io/$FIREBASE_PROJECT_ID/venueos-backend .
mv Dockerfile backend/Dockerfile

echo "Deploying to Cloud Run..."
gcloud run deploy venueos-backend \
  --image gcr.io/$FIREBASE_PROJECT_ID/venueos-backend \
  --platform managed \
  --region asia-south1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID,GEMINI_API_KEY=$GEMINI_API_KEY,HMAC_SECRET=$HMAC_SECRET,STAFF_TOKEN_SECRET=$STAFF_TOKEN_SECRET

echo "Deployment complete! Visit your Cloud Run URL to view the app."
