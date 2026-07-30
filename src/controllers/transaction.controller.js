const transactionModel=require('../models/transaction.model');
const ledgerModel=require('../models/ledger.model');
const emailService=require('../services/email.service');
const accountModel = require('../models/account.model');
const mongoose = require('mongoose');



 
/**
 * * - create a new transaction
 * THE 10-STEP TRANSACTION PROCESS
 * 1.validate the request body
 * 2.validate idempotency key
 * 3.check account status
 * 4.Derive sender balance from ledger
 * 5.create transaction with status PENDING
 * 6.create DEBIT ledger entry for sender
 * 7.create CREDIT ledger entry for receiver
 * 8.update transaction status to COMPLETED
 * 9.commit MongoDB session
 * 10.send email notification to sender and receiver
*/
async function createTransactionController(req,res){

  /**
   * 1.validate request
   */


    const {fromAccount,toAccount,amount,idempotencyKey}=req.body;

    if(!fromAccount || !toAccount ||!amount ||!idempotencyKey){
       return res.status(400).json({
            message:"FromAccount, toAccount, amount and idempotencyKey are required"

        })
    }

    const fromUserAccount= await accountModel.findOne({
        _id:fromAccount,
    })

    const toUserAccount=await accountModel.findOne({
        _id:toAccount,
    })
    if(!fromUserAccount || !toUserAccount){
        return res.status(400).json({
            message:"Invalid fromAccount or toAccount"
        })
    }

    /**
     * 2.validate IdempotencyKey
    */
   const isTransactionAlreadyExists= await transactionModel.findOne({
    idempotencyKey: idempotencyKey,
   })

   if(isTransactionAlreadyExists){
    if(isTransactionAlreadyExists.status=="COMPLETED"){
       return res.status(200).json({
            message:"Transaction already processed",
            transaction: isTransactionAlreadyExists
        })
       }
        if(isTransactionAlreadyExists.status=="PENDING"){
       return res.status(200).json({
            message:"Transaction is still processing",
           
        })
       }
        if(isTransactionAlreadyExists.status=="FAILED"){
       return res.status(500).json({
            message:"Transaction processing failed previously,please retry",
           
        })

       }
        if(isTransactionAlreadyExists.status=="REVERSED"){
        return res.status(500).json({
            message:"Transaction was reversed,please retry",
           
        })

       }
    }

       /** 
        * 3.check account status
        */

       if(fromUserAccount.status !== "ACTIVE" || toUserAccount.status !== "ACTIVE"){
        return res.status(400).json({
            message:"Both fromAccount and toAccount must be ACTIVE to process transaction"
        })
       }

       /**
        * 4.Derive sender balance from ledger
        */

       const balance = await fromUserAccount.getBalance();

           if(balance<amount){
            return res.status(400).json({
                message: `Insufficient balance. Current balance is ${balance}. Requested amount is ${amount}`
            });
           }

   


           let transaction;
          try{


        /**
         * 5.Create transaction
        */
       const session = await mongoose.startSession()
       session.startTransaction()

       transaction = (await transactionModel.create([{
        fromAccount,
        toAccount,
        amount,
        idempotencyKey,
        transactionType: "TRANSFER",
        status:"PENDING"
       }],{session}))[0]


        const debitledgerEntry = await ledgerModel.create([{
        account: fromAccount,
        amount:amount,
        transaction:transaction._id,
        type: "DEBIT"
        }],{session})



        console.log("Transfer delay started:", new Date().toISOString());
        await (()=>{
            return new Promise((resolve) => setTimeout(resolve, 15 * 1000));
        })()
        console.log("Transfer delay finished:", new Date().toISOString());



       const creditledgerEntry = await ledgerModel.create([{
        account: toAccount,
        amount:amount,
        transaction:transaction._id,
        type: "CREDIT"
        }],{session})

        await transactionModel.findOneAndUpdate(
            {_id: transaction._id},
            {status: "COMPLETED"},
            {session}
        )

        await session.commitTransaction()
        session.endSession()  
    }
     catch(error){
         console.error("Transaction failed before completion:", error);
         return res.status(400).json({
            message:"Transaction is pending due to some issue, please retry after sometimer",
        })

    }
   
     /**
      * 10.send email notification
      */

     await emailService.sendTransactionEmail(req.user.email,req.user.name,amount,toAccount)
      

     return res.status(201).json
     message:"Transaction completed successfully"
     transaction: transaction
   
}

async function createInitialFundsTransactionController(req, res) {
    const { toAccount, amount, idempotencyKey } = req.body;
    if(!toAccount || !amount || !idempotencyKey){
        return res.status(400).json({
            message: "toAccount, amount and idempotencyKey are required",
        });
    }
    const toUserAccount=await accountModel.findOne({
        _id:toAccount,
    })
    if(!toUserAccount){
        return res.status(404).json({
            message: "toAccount not found",
        });
    }

    const fromUserAccount=await accountModel.findOne({
        user:req.user._id,
        status: "ACTIVE",
    })

    if(!fromUserAccount){
        return res.status(404).json({
            message: "System user account not found",
        });
    }

    const session=await mongoose.startSession();
    session.startTransaction();

    const transaction=new transactionModel({
        fromAccount:fromUserAccount._id,
        toAccount:toUserAccount._id,
        amount,
        idempotencyKey,
        transactionType: "INITIAL_FUNDS",
        status:"PENDING",
    });

    const debitLedgerEntry=await ledgerModel.create([{
        account:fromUserAccount._id,
        amount,
        transaction:transaction._id,
        type:"DEBIT",
    }],{session});

    const creditLedgerEntry=await ledgerModel.create([{
        account:toUserAccount._id,
        amount,
        transaction:transaction._id,
        type:"CREDIT",
    }],{session});

    transaction.status="COMPLETED";
    await transaction.save({session});

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
        message: "Initial funds transaction created successfully",
        transaction,
    });
    
    
    
}


async function createDepositController(req, res) {
    let session;

    try {
        const { accountId, amount, idempotencyKey } = req.body;

        if (!accountId || !amount || !idempotencyKey) {
            return res.status(400).json({
                message: "accountId, amount and idempotencyKey are required",
            });
        }

        if (amount <= 0) {
            return res.status(400).json({
                message: "Amount must be greater than 0",
            });
        }

        const existingTransaction = await transactionModel.findOne({
            idempotencyKey,
        });

        if (existingTransaction) {
            return res.status(409).json({
                message: "Transaction already processed",
                transaction: existingTransaction,
            });
        }

        const account = await accountModel.findOne({
            _id: accountId,
            user: req.user._id,
        });

        if (!account) {
            return res.status(404).json({
                message: "Account not found",
            });
        }

        if (account.status !== "ACTIVE") {
            return res.status(400).json({
                message: "Account must be ACTIVE",
            });
        }

        session = await mongoose.startSession();
        session.startTransaction();

        const transaction = (
            await transactionModel.create(
                [
                    {
                        fromAccount: account._id,
                        toAccount: account._id,
                        amount,
                        idempotencyKey,
                        transactionType: "DEPOSIT",
                        status: "PENDING",
                    },
                ],
                { session }
            )
        )[0];

        await ledgerModel.create(
            [
                {
                    account: account._id,
                    amount,
                    transaction: transaction._id,
                    type: "CREDIT",
                },
            ],
            { session }
        );

        transaction.status = "COMPLETED";
        await transaction.save({ session });

        await session.commitTransaction();
        session.endSession();

        await emailService.sendDepositEmail(
        req.user.email,
        req.user.name,
        amount,
        account._id
        );


        return res.status(201).json({
            message: "Deposit successful",
            transaction,
        });

    } catch (err) {

    console.error(err);

    if (session?.inTransaction()) {
        await session.abortTransaction();
    }

    session?.endSession();

    return res.status(500).json({
        message: err.message
    });
}
}


async function createWithdrawController(req, res) {

    let session;

    try {

        const { accountId, amount, idempotencyKey } = req.body;

        if (!accountId || !amount || !idempotencyKey) {
            return res.status(400).json({
                message: "accountId, amount and idempotencyKey are required",
            });
        }

        if (amount <= 0) {
            return res.status(400).json({
                message: "Amount must be greater than 0",
            });
        }

        const existingTransaction = await transactionModel.findOne({
            idempotencyKey,
        });

        if (existingTransaction) {
            return res.status(409).json({
                message: "Transaction already processed",
                transaction: existingTransaction,
            });
        }

        const account = await accountModel.findOne({
            _id: accountId,
            user: req.user._id,
        });

        if (!account) {
            return res.status(404).json({
                message: "Account not found",
            });
        }

        if (account.status !== "ACTIVE") {
            return res.status(400).json({
                message: "Account must be ACTIVE",
            });
        }

        const balance = await account.getBalance();

        if (balance < amount) {
            return res.status(400).json({
                message: "Insufficient balance",
            });
        }

        session = await mongoose.startSession();
        session.startTransaction();

        const transaction = (
            await transactionModel.create(
                [
                    {
                        fromAccount: account._id,
                        toAccount: account._id,
                        amount,
                        idempotencyKey,
                        transactionType: "WITHDRAWAL",
                        status: "PENDING",
                    },
                ],
                { session }
            )
        )[0];

        await ledgerModel.create(
            [
                {
                    account: account._id,
                    amount,
                    transaction: transaction._id,
                    type: "DEBIT",
                },
            ],
            { session }
        );

        transaction.status = "COMPLETED";
        await transaction.save({ session });

        await session.commitTransaction();
        session.endSession();

        await emailService.sendWithdrawalEmail(
        req.user.email,
        req.user.name,
        amount,
        account._id
        );


        return res.status(201).json({
            message: "Withdrawal successful",
            transaction,
        });

    } catch(err){

    console.error(err);

    if (session?.inTransaction()) {
        await session.abortTransaction();
    }

    session?.endSession();

    return res.status(500).json({
        message: err.message
    });
}
}


module.exports = {
    createTransactionController,
    createInitialFundsTransactionController,
    createDepositController,
    createWithdrawController
};
