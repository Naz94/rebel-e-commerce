/**
 * middleware/tenantPlugin.js
 *
 * Global Mongoose plugin registered in server.js BEFORE any model is loaded.
 * It adds a pre-hook to every schema for the following operations:
 *   find, findOne, findOneAndUpdate, findOneAndDelete, updateOne,
 *   updateMany, deleteOne, deleteMany, countDocuments
 *
 * Rules:
 *  - If the query filter contains clientId  → allow
 *  - If the query options contain { bypassTenantFirewall: true } → allow
 *  - Otherwise → throw, blocking the query entirely
 *
 * Models that have their OWN more specific pre(/^find/) hook (Order, Product)
 * are not broken by this plugin because the plugin-level hook runs first and
 * passes through when clientId is present. The model-level hook then runs as
 * the second hook in the chain.
 *
 * BYPASS RULE (system use only):
 *   query.setOptions({ bypassTenantFirewall: true })
 *   Allowed for: cron jobs, migration scripts, super-admin system ops.
 *   NEVER expose this option to user-controlled input.
 */

const GUARDED_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'countDocuments'
];

// These models are cross-tenant by design and must never be filtered by clientId.
// Client is the tenant registry itself; no clientId column makes sense here.
const EXEMPT_MODELS = ['Client'];

module.exports = function tenantPlugin(schema) {
  GUARDED_OPS.forEach((op) => {
    schema.pre(op, function (next) {
      // Check if this schema/model is explicitly exempt
      const modelName = this?.model?.modelName || '';
      if (EXEMPT_MODELS.includes(modelName)) return next();

      // Allow explicit system-level bypass
      if (this.getOptions && this.getOptions().bypassTenantFirewall === true) return next();

      // Allow if clientId is present in the filter
      const filter = typeof this.getFilter === 'function' ? this.getFilter() : this.getQuery?.();
      if (filter && filter.clientId !== undefined) return next();

      // Block: missing clientId with no explicit bypass
      return next(
        new Error(
          `[TenantFirewall] ${op} on ${modelName || 'unknown model'} blocked: ` +
          `clientId is required. Use .setOptions({ bypassTenantFirewall: true }) ` +
          `only for system-level operations.`
        )
      );
    });
  });
};
