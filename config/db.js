const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/billing_db');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    console.log('Starting in-memory MongoDB server for development...');
    
    try {
      mongoServer = await MongoMemoryServer.create();
      const mongoUri = mongoServer.getUri();
      console.log(`In-memory MongoDB URI: ${mongoUri}`);
      
      const conn = await mongoose.connect(mongoUri);
      console.log(`In-memory MongoDB Connected: ${conn.connection.host}`);
    } catch (memoryError) {
      console.error(`Failed to start in-memory MongoDB: ${memoryError.message}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
