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


async function createTransactionController(req, res) {

    const {
        fromAccount,
        toAccount,
        amount,
        idempotencyKey
    } = req.body;


    if (!fromAccount || !toAccount || !amount || !idempotencyKey) {

        return res.status(400).json({
            message:
                "FromAccount, toAccount, amount and idempotencyKey are required"
        });

    }


    let session;
    let transaction;


    try {


        /*
            1. Idempotency check
        */

        const existingTransaction =
            await transactionModel.findOne({
                idempotencyKey
            });


        if (existingTransaction) {

            return res.status(200).json({

                message:"Transaction already processed",

                transaction:existingTransaction

            });

        }



        /*
            2. Start MongoDB Transaction
        */

        session = await mongoose.startSession();

        session.startTransaction();



        /*
            3. Lock Sender Account
        */

        const senderAccount =
            await accountModel.findOneAndUpdate(

                {
                    _id:fromAccount,
                    locked:false
                },

                {
                    $set:{
                        locked:true
                    }
                },

                {
                    new:true,
                    session
                }

            );



        if(!senderAccount){

            throw new Error(
                "Sender account is busy. Please retry."
            );

        }





        /*
            4. Lock Receiver Account
        */


        const receiverAccount =
            await accountModel.findOneAndUpdate(

                {
                    _id:toAccount,
                    locked:false
                },

                {
                    $set:{
                        locked:true
                    }
                },

                {
                    new:true,
                    session
                }

            );



        if(!receiverAccount){

            throw new Error(
                "Receiver account is busy. Please retry."
            );

        }





        /*
            5. Check Account Status
        */

        if(
            senderAccount.status !== "ACTIVE" ||
            receiverAccount.status !== "ACTIVE"
        ){

            throw new Error(
                "Both accounts must be ACTIVE"
            );

        }





        /*
            6. Check Sender Balance
        */

        const balance =
            await senderAccount.getBalance();



        if(balance < amount){

            throw new Error(
                `Insufficient balance. Current balance: ${balance}`
            );

        }





        /*
            7. Create Transaction
        */


        transaction =
        (
            await transactionModel.create(

                [
                    {
                        fromAccount,
                        toAccount,
                        amount,
                        idempotencyKey,
                        transactionType:"TRANSFER",
                        status:"PENDING"
                    }
                ],

                {
                    session
                }

            )

        )[0];







        /*
            8. Create Debit Ledger
        */


        await ledgerModel.create(

            [
                {
                    account:fromAccount,
                    amount,
                    transaction:transaction._id,
                    type:"DEBIT"
                }
            ],

            {
                session
            }

        );







        /*
            9. Create Credit Ledger
        */


        await ledgerModel.create(

            [
                {
                    account:toAccount,
                    amount,
                    transaction:transaction._id,
                    type:"CREDIT"
                }
            ],

            {
                session
            }

        );







        /*
            10. Optimistic Lock Version Update
        */


        const senderVersionUpdate =
            await accountModel.updateOne(

                {
                    _id:fromAccount,
                    version:senderAccount.version
                },

                {
                    $inc:{
                        version:1
                    }
                },

                {
                    session
                }

            );



        if(senderVersionUpdate.modifiedCount === 0){

            throw new Error(
                "Concurrent update detected on sender account"
            );

        }






        const receiverVersionUpdate =
            await accountModel.updateOne(

                {
                    _id:toAccount,
                    version:receiverAccount.version
                },

                {
                    $inc:{
                        version:1
                    }
                },

                {
                    session
                }

            );



        if(receiverVersionUpdate.modifiedCount === 0){

            throw new Error(
                "Concurrent update detected on receiver account"
            );

        }







        /*
            11. Complete Transaction
        */


        transaction =
        await transactionModel.findOneAndUpdate(

            {
                _id:transaction._id
            },

            {
                status:"COMPLETED"
            },

            {
                session,
                new:true
            }

        );






        /*
            12. Commit Transaction
        */


        await session.commitTransaction();

        session.endSession();






        /*
            13. Release Locks
        */


        await accountModel.updateMany(

            {
                _id:{
                    $in:[
                        fromAccount,
                        toAccount
                    ]
                }
            },

            {
                $set:{
                    locked:false
                }
            }

        );







        /*
            14. Send Email
        */


        await emailService.sendTransactionEmail(

            req.user.email,

            req.user.name,

            amount,

            toAccount

        );






        return res.status(201).json({

            message:
            "Transaction completed successfully",

            transaction

        });



    }



    catch(error){


        console.error(
            "Transaction failed:",
            error
        );



        if(session && session.inTransaction()){

            await session.abortTransaction();

        }



        if(session){

            session.endSession();

        }





        /*
            Release locks if transaction fails
        */


        await accountModel.updateMany(

            {
                _id:{
                    $in:[
                        fromAccount,
                        toAccount
                    ]
                }
            },

            {
                $set:{
                    locked:false
                }
            }

        );




        return res.status(400).json({

            message:error.message

        });


    }

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


async function getAccountStatementController(req, res) {

    try {

        const { accountId } = req.params;

        const account = await accountModel.findOne({
            _id: accountId,
            user: req.user._id
        });

        if (!account) {
            return res.status(404).json({
                message: "Account not found"
            });
        }


        const ledgerEntries = await ledgerModel
            .find({ account: accountId })
            .populate("transaction")
            .sort({ createdAt: 1 });


        let balance = 0;


        const statement = ledgerEntries.map((entry)=>{


            if(entry.type === "CREDIT"){
                balance += entry.amount;
            }

            else if(entry.type === "DEBIT"){
                balance -= entry.amount;
            }


            return {

                date: entry.createdAt,

                transactionType:
                    entry.transaction?.transactionType || "UNKNOWN",

                type: entry.type,

                amount: entry.amount,

                status:
                    entry.transaction?.status || "UNKNOWN",

                balance: balance

            };

        });



        return res.status(200).json({

            accountId,

            currentBalance: balance,

            totalTransactions: statement.length,

            statement

        });


    }
    catch(err){

        console.error(err);

        return res.status(500).json({
            message: err.message
        });

    }

}


module.exports = {
    createTransactionController,
    createInitialFundsTransactionController,
    createDepositController,
    createWithdrawController,
    getAccountStatementController
};
