import { Router } from "express";
import {
  createContactHandler,
  deleteContactHandler,
  listContactsHandler,
  updateContactHandler,
} from "../controllers/contacts.controller";
import { authenticate } from "../middleware/auth";

export const contactsRouter = Router();

contactsRouter.get("/contacts", authenticate, listContactsHandler);
contactsRouter.post("/contacts", authenticate, createContactHandler);
contactsRouter.put("/contacts/:id", authenticate, updateContactHandler);
contactsRouter.delete("/contacts/:id", authenticate, deleteContactHandler);
