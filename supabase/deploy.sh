#!/bin/bash
# Phase 1 Backend Deployment Script
# Run this from: portfolio-tracker/
# Prerequisites: npx supabase available (already installed via npx)

set -e

PROJECT_REF="ljnghonmulakdanqmfls"

echo "=== Phase 1 Backend Deployment ==="
echo ""

# Step 1: Login to Supabase
echo "Step 1: Authenticating with Supabase..."
npx supabase login
echo ""

# Step 2: Link project
echo "Step 2: Linking to project $PROJECT_REF..."
echo "You will be prompted for your DB password (find it in Supabase Dashboard → Settings → Database)"
npx supabase link --project-ref "$PROJECT_REF"
echo ""

# Step 3: Push migrations
echo "Step 3: Pushing database migrations..."
npx supabase db push
echo ""

# Step 4: Set secrets
echo "Step 4: Setting Edge Function secrets..."
echo "Enter your Finnhub API key (from .env VITE_FINNHUB_KEY):"
read -r FINNHUB_KEY
npx supabase secrets set FINNHUB_KEY="$FINNHUB_KEY"
echo ""

# Step 5: Deploy Edge Functions
echo "Step 5: Deploying Edge Functions..."
npx supabase functions deploy sync-prices --no-verify-jwt
npx supabase functions deploy import-ibkr-preview --no-verify-jwt
npx supabase functions deploy import-ibkr-commit --no-verify-jwt
npx supabase functions deploy recalc-snapshots --no-verify-jwt
echo ""

echo "=== Deployment Complete! ==="
echo ""
echo "Verification steps:"
echo "1. Check Supabase Dashboard → Database → Tables — all new tables should be present"
echo "2. Test sync-prices: Dashboard → Edge Functions → sync-prices → Invoke"
echo "3. Run the app: npm run dev"
echo ""
echo "Once Edge Functions are verified working:"
echo "- Remove VITE_FINNHUB_KEY from .env (prices now come from server)"
