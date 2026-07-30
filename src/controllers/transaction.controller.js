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

       if(fromUseraccount.status !="ACTIVE" || toUserAccount !== "ACTIVE"){
        return res.status(400).json({
            message:"Both fromAccount and toAccount must be ACTIVE to process transaction"
        })
       }

       /**
        * 4.Derive sender balance from ledger
        */

       const balanceData=await fromUserAccount.getBalance()

           if(balance<amount){
            res.status(400).json({
                message:' Insufficient balance.Current balance is ${balance}. Requested amount is ${amount} '
            })
           }

        /**
         * 5.
        */
       
   



   
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


module.exports = {
    createTransactionController,
    createInitialFundsTransactionController,
};
