import bcrypt from "bcryptjs";
import User from "./models/User";
import Item from "./models/Item";
import Customer from "./models/Customer";
import Order from "./models/Order";
import AccountingAccount from "./models/AccountingAccount";
import Settings from "./models/Settings";
import { log } from "./index";
//fix to

// Default admin credentials. Hardcoded for the school project (the prof needs
// to be able to log in cold). Change only by deleting the admin and re-seeding.
export const DEFAULT_ADMIN_USERNAME = "JOAPadminTIP23#";
export const DEFAULT_ADMIN_PASSWORD = "ADMINLOAJoap23#";

// Super admin credentials. Hardcoded for critical system access.
// Change only by deleting the super admin and re-seeding.
export const DEFAULT_SUPERADMIN_USERNAME = "SuperRoot92x#Sys";
export const DEFAULT_SUPERADMIN_PASSWORD = "RootAccess@7kM2Qn9p#Xvw";

// Secondary admin credentials. Hardcoded for backup administrative access.
// Change only by deleting the admin and re-seeding.
export const SECONDARY_ADMIN_USERNAME = "AdminSecure#4Jx";
export const SECONDARY_ADMIN_PASSWORD = "SecureAccess@3nP8Ky#Lmx9";

// ─── 6 Admin-level accounts ensured on every startup ────────────────────────
// All have role ADMIN — same privilege as DEFAULT_ADMIN_USERNAME.
export const EXTRA_ADMINS: Array<{ username: string; password: string }> = [
  { username: "superadmin_joap1",  password: "JoapSA@Kx9#mP2Lv" },
  { username: "superadmin_joap2",  password: "JoapSA@Rn4#qW7Tz" },
  { username: "superadmin_joap3",  password: "JoapSA@Yb6#dH3Fc" },
  { username: "joadmin_alpha1",    password: "JoapAdm@Nx8#pY3Wr" },
  { username: "joadmin_bravo2",    password: "JoapAdm@Qt5#rZ6Ks" },
  { username: "joadmin_delta3",    password: "JoapAdm@Mv2#wC4Jp" },
];

/**
 * Ensures all extra admin accounts exist, are active, and have role ADMIN.
 * Runs on every startup — safe to call even if accounts already exist.
 */
export async function ensureSuperAdmins() {
  for (const sa of EXTRA_ADMINS) {
    const existing = await User.findOne({ username: sa.username.toLowerCase() });
    if (!existing) {
      const hashed = await bcrypt.hash(sa.password, 10);
      await User.create({ username: sa.username.toLowerCase(), password: hashed, role: "ADMIN", isActive: true });
      log(`Admin account created: ${sa.username}`, "seed");
    } else {
      let changed = false;
      if (existing.role !== "ADMIN") { existing.role = "ADMIN"; changed = true; }
      if (!existing.isActive) { existing.isActive = true; changed = true; }
      if (changed) await existing.save();
    }
  }
  log("Extra admin accounts verified ✓", "seed");
  for (const sa of EXTRA_ADMINS) {
    log(`  username=${sa.username}  password=${sa.password}`, "seed");
  }
}

export async function seedDatabase() {
  try {
    // Migrate legacy admin/admin123 → JoapAdmin20Jk/AdminPriv23#Ds. We just
    // rename the existing user and reset the password so old DBs don't keep
    // the insecure default after a code update.
    const legacyAdmin = await User.findOne({ username: "admin" });
    if (legacyAdmin) {
      legacyAdmin.username = DEFAULT_ADMIN_USERNAME;
      legacyAdmin.password = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
      await legacyAdmin.save();
      log(`Renamed legacy admin → ${DEFAULT_ADMIN_USERNAME} (password reset)`, "seed");
    }

    const existingAdmin = await User.findOne({ username: DEFAULT_ADMIN_USERNAME });
    if (!existingAdmin) {
      log("Seeding database...", "seed");

      const adminPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
      const secondaryAdminPassword = await bcrypt.hash(SECONDARY_ADMIN_PASSWORD, 10);
      const employeePassword = await bcrypt.hash("employee123", 10);
      const superadminPassword = await bcrypt.hash(DEFAULT_SUPERADMIN_PASSWORD, 10);

      await User.create([
        { username: DEFAULT_SUPERADMIN_USERNAME, password: superadminPassword, role: "SUPERADMIN", isActive: true },
        { username: DEFAULT_ADMIN_USERNAME, password: adminPassword, role: "ADMIN", isActive: true },
        { username: SECONDARY_ADMIN_USERNAME, password: secondaryAdminPassword, role: "ADMIN", isActive: true },
        { username: "employee", password: employeePassword, role: "EMPLOYEE", isActive: true },
      ]);

      await Customer.create([
        { name: "Juan Dela Cruz", email: "juan@email.com", phone: "09171234567", address: "123 Rizal St, Manila" },
        { name: "Maria Santos", email: "maria@email.com", phone: "09189876543", address: "456 Bonifacio Ave, Quezon City" },
        { name: "Pedro Reyes", email: "pedro@email.com", phone: "09201112233", address: "789 Mabini Rd, Makati" },
        { name: "Ana Garcia", email: "ana@email.com", phone: "09154455667", address: "321 Luna St, Pasig" },
        { name: "Roberto Lim", email: "roberto@email.com", phone: "09167788990", address: "654 Del Pilar Blvd, Taguig" },
      ]);

      await Item.create([
        { itemName: "Portland Cement", category: "Cement & Masonry", supplierName: "Republic Cement", unitPrice: 280, currentQuantity: 150, reorderLevel: 30, barcode: "CEM001" },
        { itemName: "Deformed Steel Bar 10mm", category: "Hardware & Fixtures", supplierName: "Steel Asia", unitPrice: 185, currentQuantity: 200, reorderLevel: 50, barcode: "STL001" },
        { itemName: "Hollow Blocks 4\"", category: "Cement & Masonry", supplierName: "Local Supplier", unitPrice: 12, currentQuantity: 500, reorderLevel: 100, barcode: "MSN001" },
        { itemName: "Plywood 1/4\" Marine", category: "Lumber & Wood", supplierName: "Wood Industries", unitPrice: 450, currentQuantity: 45, reorderLevel: 15, barcode: "WD001" },
        { itemName: "GI Wire #16", category: "Hardware & Fixtures", supplierName: "Steel Corp", unitPrice: 85, currentQuantity: 80, reorderLevel: 20, barcode: "WR001" },
        { itemName: "Paint Latex White 4L", category: "Paint & Coatings", supplierName: "Boysen", unitPrice: 650, currentQuantity: 8, reorderLevel: 10, barcode: "PNT001" },
        { itemName: "PVC Pipe 4\" x 10ft", category: "Pipes & Fittings", supplierName: "Atlanta Industries", unitPrice: 320, currentQuantity: 35, reorderLevel: 10, barcode: "PLB001" },
        { itemName: "Roof Nail 3\"", category: "Fasteners", supplierName: "Metal Works", unitPrice: 120, currentQuantity: 5, reorderLevel: 15, barcode: "NL001" },
        { itemName: "Sand (per cubic meter)", category: "Cement & Masonry", supplierName: "Quarry Supply", unitPrice: 1200, currentQuantity: 20, reorderLevel: 5, barcode: "AGG001" },
        { itemName: "Gravel (per cubic meter)", category: "Cement & Masonry", supplierName: "Quarry Supply", unitPrice: 1400, currentQuantity: 18, reorderLevel: 5, barcode: "AGG002" },
        { itemName: "Circuit Breaker 20A", category: "Electrical", supplierName: "Schneider", unitPrice: 450, currentQuantity: 30, reorderLevel: 10, barcode: "EL001" },
        { itemName: "Garden Hose 1/2\" x 30m", category: "Plumbing", supplierName: "Local Supplier", unitPrice: 280, currentQuantity: 15, reorderLevel: 5, barcode: "PLM001" },
        { itemName: "Claw Hammer 16oz", category: "Tools", supplierName: "Stanley", unitPrice: 350, currentQuantity: 25, reorderLevel: 8, barcode: "TL001" },
        { itemName: "Safety Helmet", category: "Safety Equipment", supplierName: "3M", unitPrice: 180, currentQuantity: 40, reorderLevel: 10, barcode: "SF001" },
      ]);

      await AccountingAccount.create([
        { accountCode: "1000", accountName: "Cash/GCash", accountType: "Asset", balance: 0 },
        { accountCode: "1100", accountName: "Accounts Receivable", accountType: "Asset", balance: 0 },
        { accountCode: "1200", accountName: "Inventory", accountType: "Asset", balance: 0 },
        { accountCode: "2000", accountName: "Accounts Payable", accountType: "Liability", balance: 0 },
        { accountCode: "3000", accountName: "Owner's Equity", accountType: "Equity", balance: 0 },
        { accountCode: "4000", accountName: "Sales Revenue", accountType: "Revenue", balance: 0 },
        { accountCode: "5000", accountName: "Cost of Goods Sold", accountType: "Expense", balance: 0 },
        { accountCode: "5100", accountName: "Operating Expenses", accountType: "Expense", balance: 0 },
      ]);

      await Settings.create({
        companyName: "JOAP Hardware Trading",
        theme: "light",
        autoApplyOffers: true,
        showSavingsSummary: true,
      });

      log("Database seeded successfully!", "seed");
      log(`Super Admin credentials: username=${DEFAULT_SUPERADMIN_USERNAME}, password=${DEFAULT_SUPERADMIN_PASSWORD}`, "seed");
      log(`Admin credentials: username=${DEFAULT_ADMIN_USERNAME}, password=${DEFAULT_ADMIN_PASSWORD}`, "seed");
      log(`Secondary Admin credentials: username=${SECONDARY_ADMIN_USERNAME}, password=${SECONDARY_ADMIN_PASSWORD}`, "seed");
      log("Employee credentials: username=employee, password=employee123", "seed");
    }

    await migrateExistingOrders();
  } catch (err) {
    console.error("Seeding error:", err);
  }
}

async function migrateExistingOrders() {
  try {
    const ordersNeedingMigration = await Order.find({
      $or: [
        { orderType: { $exists: false } },
        { paymentStatus: { $exists: false } },
        { fulfillmentStatus: { $exists: false } },
        { "items.qty": { $exists: false } },
      ],
    }).lean();

    if (ordersNeedingMigration.length === 0) return;

    log(`Migrating ${ordersNeedingMigration.length} existing orders to new schema...`, "seed");

    for (const order of ordersNeedingMigration) {
      const updateData: Record<string, any> = {};

      if (!order.orderType) updateData.orderType = "walkin_pickup";
      if (!order.orderChannel) updateData.orderChannel = "walkin";
      if (!order.paymentStatus) {
        const cs = (order as any).currentStatus || "";
        if (cs === "Completed" || cs === "completed") updateData.paymentStatus = "paid";
        else if (cs === "Paid" || cs === "paid") updateData.paymentStatus = "paid";
        else updateData.paymentStatus = "pending_payment";
      }
      if (!order.paymentMethod) updateData.paymentMethod = "cash";
      if (!order.fulfillmentStatus) {
        const cs = (order as any).currentStatus || "";
        if (cs === "Completed" || cs === "completed") updateData.fulfillmentStatus = "completed";
        else if (cs === "In Transit") updateData.fulfillmentStatus = "out_for_delivery";
        else if (cs === "Released" || cs === "Pending Release") updateData.fulfillmentStatus = "ready";
        else if (cs === "Processing") updateData.fulfillmentStatus = "processing";
        else updateData.fulfillmentStatus = "pending";
      }
      if (typeof order.deliveryFee === "undefined") updateData.deliveryFee = 0;
      if (typeof order.subtotal === "undefined") updateData.subtotal = (order as any).totalAmount || 0;

      const oldItems: any[] = (order as any).items || [];
      const needsItemMigration = oldItems.some((it) => typeof it.qty === "undefined");
      if (needsItemMigration) {
        updateData.items = oldItems.map((it) => ({
          itemId: it.itemId,
          itemName: it.itemName,
          qty: it.quantity ?? it.qty ?? 1,
          originalUnitPrice: it.unitPrice ?? it.originalUnitPrice ?? 0,
          discountedUnitPrice: it.unitPrice ?? it.discountedUnitPrice ?? it.originalUnitPrice ?? 0,
          discountApplied: it.discountApplied ?? false,
          offerName: it.offerName ?? "",
          lineTotal: it.lineTotal ?? (it.quantity ?? 1) * (it.unitPrice ?? 0),
        }));
      }

      if (Object.keys(updateData).length > 0) {
        await Order.updateOne({ _id: order._id }, { $set: updateData });
      }
    }

    log(`Migration complete: ${ordersNeedingMigration.length} orders updated.`, "seed");
  } catch (err) {
    console.error("Migration error:", err);
  }
}
