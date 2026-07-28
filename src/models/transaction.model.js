const mongoose=require('mongoose');


const transactionSchema=new mongoose.Schema({

    fromAccount:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"account",
        required:[true,"Transaction must have a from account"],
        index:true
    },
    toAccount:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"account",
        required:[true,"Transaction must have a to account"],
        index:true
    },
    status:{
        type:String,
        enum:{
            values:["PENDING","COMPLETED","FAILED","REVERSED"],
            message:"Status must be either PENDING, COMPLETED or FAILED or REVERSED",
        },
        default:"PENDING"
    },
    amount:{
        type:Number,
        required:[true,"Transaction must have an amount"],
        min:[0,"Transaction amount must be greater than 0"]
    },
    idempotencyKey:{
        type:String,
        required:[true,"Transaction must have an idempotency key"],
        index:true,
        unique:true
    }
},{
    
    timestamps:true
})  


const transactionModel=mongoose.model("transaction",transactionSchema);

module.exports=transactionModel;