// helpers/company-filter.helper.js
/**
 * Helper function để thêm company filter vào query
 * - Super Admin: không filter (thấy tất cả)
 * - Company Admin: chỉ thấy data của công ty mình
 */
module.exports.addCompanyFilter = (baseFilter, account) => {
  if (!account) {
    throw new Error("Account is required");
  }

  // Super Admin → không thêm filter
  if (account.isSuperAdmin) {
    return { ...baseFilter };
  }

  // Company Admin → phải có companyId
  if (!account.companyId) {
    throw new Error("Company Admin must have companyId");
  }

  return {
    ...baseFilter,
    companyId: account.companyId,
  };
};

/**
 * Kiểm tra quyền sửa/xóa resource
 * - Super Admin: được phép tất cả
 * - Company Admin: chỉ được sửa/xóa resource của công ty mình
 */
module.exports.canModifyResource = (resource, account) => {
  if (!account) return false;

  // Super Admin → OK
  if (account.isSuperAdmin) return true;

  // Company Admin → kiểm tra companyId
  if (!account.companyId) return false;

  return String(resource.companyId) === String(account.companyId);
};

/**
 * Lấy thông tin company filter để hiển thị UI
 */
module.exports.getCompanyInfo = (account) => {
  return {
    isSuperAdmin: Boolean(account?.isSuperAdmin),
    companyId: account?.companyId || null,
    canSeeAllCompanies: Boolean(account?.isSuperAdmin),
  };
};

