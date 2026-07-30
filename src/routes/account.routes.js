const express=require('express');
const authMiddleware=require('../middleware/auth.middleware');
const accountController=require('../controllers/account.controller');


const router=express.Router();

/**
 * - POST /api/accounts
 * - create a new account
 * - protected route
 */
router.post("/",authMiddleware.authMiddleware,accountController.createAccountController);



/**
 * -GET /api/accounts
 * -get all accounts of logged-in user
 * -protected route
 */
router.get("/",authMiddleware.authMiddleware,accountController.getUserAccountsController)



/**
 * -GET /api/accounts/balance:accountId
 */




module.exports=router;