import { flushSync } from "react-dom";
export function registerCRMTools(api, open) {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const register = (tool) => {
    try {
      Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Browsers without WebMCP remain fully usable. */
    }
  };
  register({
    name: "search_crm_records",
    title: "Search CRM records",
    description:
      "Search records in the signed-in CRM workspace. Returns matching names, record types and IDs.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1, maxLength: 200 } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input) {
      if (
        typeof input?.query !== "string" ||
        !input.query.trim() ||
        input.query.length > 200
      )
        throw Error("Enter a search query of 1–200 characters");
      const records = await api("/search?q=" + encodeURIComponent(input.query));
      return records.map((r) => ({
        id: r.id,
        entity: r.entity,
        name: r.data.name,
      }));
    },
  });
  register({
    name: "open_crm_record",
    title: "Open CRM record",
    description:
      "Open the existing CRM record detail dialog for review. Does not modify the record.",
    inputSchema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          enum: ["leads", "customers", "deals", "activities"],
        },
        id: { type: "string", format: "uuid" },
      },
      required: ["entity", "id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      if (
        !["leads", "customers", "deals", "activities"].includes(
          input?.entity,
        ) ||
        !/^[-a-f0-9]{36}$/i.test(input?.id || "")
      )
        throw Error("Choose a valid CRM record type and ID");
      const record = await api("/" + input.entity + "/" + input.id);
      flushSync(() => open(input.entity, input.id));
      return { opened: true, id: record.id, name: record.data.name };
    },
  });
  return () => lifecycle.abort();
}
