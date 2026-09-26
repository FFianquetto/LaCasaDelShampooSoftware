import { getDb, closeDb } from "../db.js";

getDb();
console.log("Migraciones aplicadas.");
closeDb();
