CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  phone VARCHAR(30) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'staff') NOT NULL DEFAULT 'staff',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS login_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id CHAR(36) NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  device_label VARCHAR(120) NULL,
  logged_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logged_out_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_refresh_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  session_id BIGINT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (session_id) REFERENCES login_history(id) ON DELETE SET NULL,
  INDEX idx_user_refresh_user_id (user_id),
  INDEX idx_user_refresh_expires_at (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  email VARCHAR(191) NOT NULL,
  ip_address VARCHAR(45) NOT NULL DEFAULT '',
  attempt_count INT NOT NULL DEFAULT 0,
  first_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  blocked_until DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (email, ip_address),
  INDEX idx_auth_login_attempts_blocked_until (blocked_until)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  scope VARCHAR(80) NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status ENUM('pending', 'completed') NOT NULL DEFAULT 'pending',
  response_json MEDIUMTEXT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uniq_idempotency_scope_key (user_id, scope, idempotency_key),
  INDEX idx_idempotency_expires_at (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  role ENUM('admin', 'staff') NOT NULL,
  module_key VARCHAR(80) NOT NULL,
  can_view TINYINT(1) NOT NULL DEFAULT 0,
  can_add TINYINT(1) NOT NULL DEFAULT 0,
  can_edit TINYINT(1) NOT NULL DEFAULT 0,
  can_delete TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_role_module (role, module_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  category ENUM('Food', 'Beverages', 'Cleaning', 'Personal Care', 'Snacks', 'Household', 'Other') NOT NULL,
  sku VARCHAR(100) NOT NULL UNIQUE,
  unit VARCHAR(30) NOT NULL DEFAULT 'pcs',
  buy_price DECIMAL(10,2) NOT NULL,
  sell_price DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  min_stock INT NOT NULL DEFAULT 10,
  supplier VARCHAR(191) NULL,
  expiry_date DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_products_name (name),
  INDEX idx_products_category (category),
  INDEX idx_products_active (is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(191) NULL,
  phone VARCHAR(40) NOT NULL UNIQUE,
  address VARCHAR(255) NULL,
  type ENUM('VIP', 'Regular', 'Wholesale') NOT NULL DEFAULT 'Regular',
  due DECIMAL(10,2) NOT NULL DEFAULT 0,
  loyalty_points INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customers_phone (phone),
  INDEX idx_customers_type (type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  customer_id CHAR(36) NULL,
  customer_name VARCHAR(191) NULL,
  customer_phone VARCHAR(40) NOT NULL,
  customer_address VARCHAR(255) NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  paid DECIMAL(10,2) NOT NULL DEFAULT 0,
  due DECIMAL(10,2) NOT NULL DEFAULT 0,
  note TEXT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_sales_created_at (created_at),
  INDEX idx_sales_customer_id (customer_id),
  INDEX idx_sales_customer_phone (customer_phone)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sale_items (
  id CHAR(36) PRIMARY KEY,
  sale_id BIGINT NOT NULL,
  product_id CHAR(36) NOT NULL,
  product_name VARCHAR(191) NOT NULL,
  quantity INT NOT NULL,
  buy_price DECIMAL(10,2) NOT NULL,
  sell_price DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_sale_items_sale_id (sale_id),
  INDEX idx_sale_items_product_id (product_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_history (
  id CHAR(36) PRIMARY KEY,
  product_id CHAR(36) NOT NULL,
  product_name VARCHAR(191) NOT NULL,
  change_type ENUM('restock', 'sale', 'adjustment') NOT NULL,
  quantity_change INT NOT NULL,
  quantity_before INT NOT NULL,
  quantity_after INT NOT NULL,
  note VARCHAR(255) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_stock_history_product_id (product_id),
  INDEX idx_stock_history_created_at (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS expenses (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(191) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  category ENUM('Rent', 'Electricity', 'Salary', 'Purchase', 'Transport', 'Other') NOT NULL,
  note VARCHAR(255) NULL,
  expense_date DATE NOT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  deleted_by CHAR(36) NULL,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_expenses_date (expense_date),
  INDEX idx_expenses_is_deleted (is_deleted)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS due_payments (
  id CHAR(36) PRIMARY KEY,
  sale_id BIGINT NULL,
  customer_id CHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  note VARCHAR(255) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_due_payments_customer_id (customer_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  action VARCHAR(120) NOT NULL,
  table_name VARCHAR(120) NULL,
  record_id VARCHAR(120) NULL,
  detail TEXT NOT NULL,
  user_id CHAR(36) NULL,
  user_email VARCHAR(191) NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_audit_logs_created_at (created_at),
  INDEX idx_audit_logs_action (action)
) ENGINE=InnoDB;

SET @role_permissions_can_edit_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'role_permissions'
    AND COLUMN_NAME = 'can_edit'
);

SET @role_permissions_can_edit_sql := IF(
  @role_permissions_can_edit_exists = 0,
  'ALTER TABLE role_permissions ADD COLUMN can_edit TINYINT(1) NOT NULL DEFAULT 0 AFTER can_add',
  'SELECT 1'
);

PREPARE role_permissions_can_edit_stmt FROM @role_permissions_can_edit_sql;
EXECUTE role_permissions_can_edit_stmt;
DEALLOCATE PREPARE role_permissions_can_edit_stmt;

SET @expenses_is_deleted_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'expenses'
    AND COLUMN_NAME = 'is_deleted'
);

SET @expenses_is_deleted_sql := IF(
  @expenses_is_deleted_exists = 0,
  'ALTER TABLE expenses ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0 AFTER created_at',
  'SELECT 1'
);

PREPARE expenses_is_deleted_stmt FROM @expenses_is_deleted_sql;
EXECUTE expenses_is_deleted_stmt;
DEALLOCATE PREPARE expenses_is_deleted_stmt;

SET @expenses_deleted_at_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'expenses'
    AND COLUMN_NAME = 'deleted_at'
);

SET @expenses_deleted_at_sql := IF(
  @expenses_deleted_at_exists = 0,
  'ALTER TABLE expenses ADD COLUMN deleted_at DATETIME NULL AFTER is_deleted',
  'SELECT 1'
);

PREPARE expenses_deleted_at_stmt FROM @expenses_deleted_at_sql;
EXECUTE expenses_deleted_at_stmt;
DEALLOCATE PREPARE expenses_deleted_at_stmt;

SET @expenses_deleted_by_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'expenses'
    AND COLUMN_NAME = 'deleted_by'
);

SET @expenses_deleted_by_sql := IF(
  @expenses_deleted_by_exists = 0,
  'ALTER TABLE expenses ADD COLUMN deleted_by CHAR(36) NULL AFTER deleted_at',
  'SELECT 1'
);

PREPARE expenses_deleted_by_stmt FROM @expenses_deleted_by_sql;
EXECUTE expenses_deleted_by_stmt;
DEALLOCATE PREPARE expenses_deleted_by_stmt;

INSERT INTO role_permissions (role, module_key, can_view, can_add, can_edit, can_delete)
VALUES
('staff', 'dashboard', 1, 0, 0, 0),
('staff', 'products', 1, 0, 0, 0),
('staff', 'customers', 1, 0, 1, 0),
('staff', 'sales', 1, 1, 1, 0),
('staff', 'reports', 0, 0, 0, 0),
('staff', 'expenses', 0, 0, 0, 0),
('staff', 'audit', 0, 0, 0, 0),
('staff', 'stock', 1, 0, 1, 0),
('staff', 'permissions', 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_add = VALUES(can_add),
  can_edit = VALUES(can_edit),
  can_delete = VALUES(can_delete);
