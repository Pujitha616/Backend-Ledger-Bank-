const userModel=require('../models/user.model');
const jwt=require('jsonwebtoken');




async function authMiddleware(req,res,next){
    const token=req.cookies.token || req.headers.authorization?.split(" ")[1];

    if(!token){
        return res.status(401).json({
           
            message:"Unauthorized access,token is missing",
            
        })

    }
    try{
        const decoded=jwt.verify(token,process.env.JWT_SECRET);

        const user=await userModel.findById(decoded.userid);

        req.user=user;

        return next();


    }catch(err){
        return res.status(401).json({
            message:"Unauthorized access,token is invalid",
        })
    }

}

async function authSystemUserMiddleware(req,res,next){
    const token=req.cookies.token || req.headers.authorization?.split(" ")[1];

    if(!token){
        return res.status(401).json({
            message:"Unauthorized access,token is missing",
        })
    }
    try{
        const decoded=jwt.verify(token,process.env.JWT_SECRET);

        const user=await userModel.findById(decoded.userid).select("+systemUser");
        if(!user.systemUser){
            return res.status(403).json({
                message:"Forbidden access,system user only",
            })
        }
    
    req.user=user;

    return next();
    }
    catch(err){
        return res.status(401).json({
            message:"Unauthorized access,token is invalid",
        })

    }
}
module.exports={
    authMiddleware,
    authSystemUserMiddleware

                             
}