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
  --set-env-vars GEMINI_API_KEY=$GEMINI_API_KEY,HMAC_SECRET=$HMAC_SECRET,STAFF_TOKEN_SECRET=$STAFF_TOKEN_SECRET

# Set up Cloud Scheduler Job for density analysis
echo "Creating Cloud Scheduler job..."
CLOUD_FUNC_URL="https://asia-south1-$FIREBASE_PROJECT_ID.cloudfunctions.net/density_analysis"

gcloud scheduler jobs create http density-analysis-scheduler \
    --schedule="* * * * *" \
    --uri=$CLOUD_FUNC_URL \
    --location=asia-south1 \
    --http-method=GET || \
gcloud scheduler jobs update http density-analysis-scheduler \
    --schedule="* * * * *" \
    --uri=$CLOUD_FUNC_URL \
    --location=asia-south1 \
    --http-method=GET

echo "Deployment complete!"
