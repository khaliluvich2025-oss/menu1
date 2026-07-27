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
//
// A failed connect() attempt must NOT stay cached: without the .catch()
// below, a single transient failure on a cold Lambda instance (e.g. a slow
// TLS handshake) would permanently wedge `global._emberMongoClientPromise`
// as a rejected promise for that instance's entire lifetime — every request
// it ever handles again would replay the same dead rejection instead of
// getting a chance to reconnect. Confirmed live: this caused every other
// request to /api/menu to 500 while requests landing on unaffected warm
// instances kept succeeding. Clearing the cache on failure lets the next
// call retry with a fresh connection instead.
function getClientPromise() {
  if (!global._emberMongoClientPromise) {
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    global._emberMongoClientPromise = client.connect().catch((err) => {
      global._emberMongoClientPromise = null;
      throw err;
    });
  }
  return global._emberMongoClientPromise;
}

// connect-mongo's session store needs a stable promise reference at
// construction time (see server.js), so this is resolved once, here, at
// require-time. If that specific attempt fails, the session store stays
// degraded for this instance's lifetime — an existing, accepted tradeoff
// (see the comment in server.js). Route handlers use getDb() below instead,
// which re-derives the client promise fresh on every failed attempt.
const clientPromise = getClientPromise();

let dbInstance = null;
async function getDb() {
  if (!dbInstance) {
    const client = await getClientPromise();
    dbInstance = client.db(DB_NAME);
  }
  return dbInstance;
}

module.exports = { clientPromise, getDb, DB_NAME };
