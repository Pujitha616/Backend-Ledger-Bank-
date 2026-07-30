const express=require('express');
const cookieParser=require('cookie-parser');






const app=express();


app.use(express.json());
app.use(cookieParser());

/**
 * - auth routes
 */
const authRouter=require('./routes/auth.routes');
const accountRouter=require('./routes/account.routes');
const transactionRoutes=require('./routes/transaction.routes');


/**
 * -  use routes
 */
app.get("/", (freq,res)=>{
    res.send("Ledger service is up and running")
})

app.use("/api/auth",authRouter);
app.use("/api/accounts",accountRouter);
app.use("/api/transactions",transactionRoutes);



module.exports=app;
