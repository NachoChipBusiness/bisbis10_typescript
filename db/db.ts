import { Client } from "pg";

const client = new Client({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE,
});

client.connect((err: Error) => {
  if (err) {
    console.error("DB connection error", err.stack);
  } else {
    console.log("connected to DB");
  }
});

export default client;
