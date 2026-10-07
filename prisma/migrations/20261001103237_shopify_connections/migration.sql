-- CreateTable
CREATE TABLE `shopify_connections` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `encrypted_access_token` TEXT NOT NULL,
    `scopes` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `shopify_connections_shop_idx`(`shop`),
    INDEX `shopify_connections_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `shopify_connections_tenant_id_shop_key`(`tenant_id`, `shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `shopify_connections` ADD CONSTRAINT `shopify_connections_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
