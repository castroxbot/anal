#!/bin/bash
set -e

echo "🚀 PumpScan Setup"
echo "================="

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node -v)"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Check for .env.local
if [ ! -f ".env.local" ]; then
  echo ""
  echo "⚠️  .env.local not found. Creating from example..."
  cp .env.example .env.local
  echo "✏️  Edit .env.local and set your DATABASE_URL"
  echo "   Then re-run this script"
  exit 0
fi

# Check DATABASE_URL
if grep -q "user:password" .env.local; then
  echo ""
  echo "⚠️  Please update DATABASE_URL in .env.local"
  echo "   Example: postgresql://postgres:postgres@localhost:5432/pumpfun_analyzer"
  exit 1
fi

# Generate Prisma client
echo ""
echo "🔧 Generating Prisma client..."
npx prisma generate

# Push schema to database
echo ""
echo "🗄️  Pushing schema to database..."
npx prisma db push

echo ""
echo "✅ Setup complete!"
echo ""
echo "Start the dev server:"
echo "  npm run dev"
echo ""
echo "Open: http://localhost:3000"
