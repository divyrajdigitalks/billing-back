const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/billing_db';
  console.log(`Attempting to connect to MongoDB at: ${mongoUri}`);
  
  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`✅ MongoDB Connected Successfully: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Error connecting to MongoDB: ${error.message}`);
    console.log('🚀 Starting in-memory MongoDB server for development...');
    
    try {
      mongoServer = await MongoMemoryServer.create({
        instance: {
          dbName: 'billing_db',
        },
      });
      const inMemoryUri = mongoServer.getUri();
      console.log(`In-memory MongoDB URI: ${inMemoryUri}`);
      
      const conn = await mongoose.connect(inMemoryUri);
      console.log(`✅ In-memory MongoDB Connected Successfully: ${conn.connection.host}`);
    } catch (memoryError) {
      console.error(`❌ Failed to start in-memory MongoDB: ${memoryError.message}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
