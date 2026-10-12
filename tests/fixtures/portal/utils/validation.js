const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function validateGstin(gstin) {
  return !gstin || gstinPattern.test(String(gstin).toUpperCase());
}

export function validateEmail(email) {
  return !email || emailPattern.test(String(email));
}

export function requireFields(body, fields) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === "") {
      throw badRequest(`${field} is required`);
    }
  }
}
