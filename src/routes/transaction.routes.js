const {Router} = require("express");
const authMiddleware=require('../middleware/auth.middleware');
const transactionController=require('../controllers/transaction.controller');





const transactionRoutes=Router();

/**
 * - POST /api/transactions
 * - create a new transaction
 */

transactionRoutes.post("/", authMiddleware.authMiddleware, transactionController.createTransactionController);




/**
 * -POST /api/transactions/system/initial-funds
 * -create initial funds transaction for system account
 */
transactionRoutes.post(
    "/system/initial-funds",
    authMiddleware.authSystemUserMiddleware,
    transactionController.createInitialFundsTransactionController
);



/**
 * POST /api/transactions/deposit
 */
transactionRoutes.post(
    "/deposit",
    authMiddleware.authMiddleware,
    transactionController.createDepositController
);

/**
 * POST /api/transactions/withdraw
 */
transactionRoutes.post(
    "/withdraw",
    authMiddleware.authMiddleware,
    transactionController.createWithdrawController
);

module.exports=transactionRoutes;
