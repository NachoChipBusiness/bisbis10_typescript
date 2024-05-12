import { Client } from "pg";

const pgCredentials = {
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE,
};

let client = new Client(pgCredentials);

async function connectToDatabase() {
  // Sometimes the NodeJS server starts before the PG database becomes ready. When this
  // happens the connection to the database fails. In order to give time to the DB to
  // become ready, we retry the connection in case of failure (waiting 1 sec between retries)
  while (true) {
    try {
      await client.connect();
      console.log("connected to DB");
      break;
    } catch (err) {
      console.log("DB connection error, we will try again in 1sec");
      // client.end();
      await new Promise(r => setTimeout(r, 1000));
      client = new Client(pgCredentials);      
    }
  }
}

connectToDatabase();

function getClient() {
  return client;
}

export default getClient;
