import { z } from "zod";
const text = z.string().trim().max(500).default("");
const required = z.string().trim().min(1).max(200);
const email = z.union([z.literal(""), z.email()]).default("");
const url = z
  .union([
    z.literal(""),
    z.url().refine((v) => /^https?:\/\//i.test(v), "Use an http or https URL"),
  ])
  .default("");
const date = z.union([z.literal(""), z.iso.date()]).default("");
const money = z.coerce.number().min(0).max(999999999999).default(0);
const notes = z.string().max(10000).default("");
const common = {
  company: text,
  designation: text,
  email,
  phone: text,
  alternate_phone: text,
  website: url,
  gstin: text,
  industry: text,
  address: text,
  source: text,
  notes,
};
export const schemas = {
  leads: z
    .object({
      ...common,
      name: required,
      service: text,
      value: money,
      close_date: date,
      stage: required.default("New"),
    })
    .strict(),
  customers: z
    .object({
      ...common,
      name: required,
      contact_name: text,
      contact_email: email,
      contact_phone: text,
      status: z
        .enum(["Active", "Prospect", "On Hold", "Inactive"])
        .default("Prospect"),
    })
    .strict(),
  deals: z
    .object({
      name: required,
      source: text,
      service: text,
      value: money,
      probability: z.coerce.number().min(0).max(100).default(0),
      close_date: date,
      notes,
      stage: z
        .enum(["New", "Qualified", "Proposal", "Negotiation", "Won", "Lost"])
        .default("New"),
    })
    .strict(),
  activities: z
    .object({
      name: required,
      type: z
        .enum(["Call", "Meeting", "Email", "Task", "Follow-up"])
        .default("Task"),
      due_date: date,
      time: z
        .union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)])
        .default(""),
      priority: z.enum(["Low", "Medium", "High"]).default("Medium"),
      status: z
        .enum(["Pending", "In Progress", "Completed", "Cancelled"])
        .default("Pending"),
      description: notes,
    })
    .strict(),
};
export const envelope = z
  .object({
    data: z.record(z.string(), z.unknown()),
    assignee_id: z.uuid().nullable().optional(),
    customer_id: z.uuid().nullable().optional(),
    lead_id: z.uuid().nullable().optional(),
    version: z.number().int().positive().optional(),
    comment: z.string().trim().max(5000).optional(),
  })
  .strict();
export const userSchema = z
  .object({
    name: required,
    email: z.email(),
    role: z.enum(["Admin", "Sales Manager", "Sales Executive", "Viewer"]),
    active: z.boolean().default(true),
    password: z.string().min(12).max(200).optional(),
  })
  .strict();
export const settingsSchema = z
  .object({
    company_name: required,
    logo_url: url,
    address: text,
    gstin: text,
    email,
    phone: text,
    website: url,
    lead_stages: z
      .array(required)
      .min(3)
      .max(15)
      .refine(
        (a) =>
          ["New", "Contacted", "Converted"].every((x) => a.includes(x)) &&
          new Set(a).size === a.length,
        "Keep New, Contacted and Converted; stages must be unique",
      ),
  })
  .strict();
