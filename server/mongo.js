const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || "ember_table";

if (!MONGODB_URI) {
  throw new Error(
    "MONGODB_URI is not set. Create a free MongoDB Atlas cluster (M0 tier, " +
    "no credit card required) at https://www.mongodb.com/cloud/atlas, then " +
    "set MONGODB_URI in .env (local) or the Vercel project's environment " +
    "variables (production) to its connection string."
  );
}

// Cached on `global` so the same connection survives across warm invocations
// of one serverless instance (and hot-reloads in local --watch dev) instead
// of opening a fresh connection per request, which would exhaust MongoDB's
// connection limit under real traffic. This is the connection pattern
// MongoDB's own serverless/Vercel guides recommend.
if (!global._emberMongoClientPromise) {
  const client = new MongoClient(MONGODB_URI);
  global._emberMongoClientPromise = client.connect();
}
const clientPromise = global._emberMongoClientPromise;

let dbInstance = null;
async function getDb() {
  if (!dbInstance) {
    const client = await clientPromise;
    dbInstance = client.db(DB_NAME);
  }
  return dbInstance;
}

module.exports = { clientPromise, getDb, DB_NAME };
