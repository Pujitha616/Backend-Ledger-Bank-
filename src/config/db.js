const mongoose=require('mongoose');




function connectToDB(){
    mongoose.connect(process.env.MONGO_URI)
        
    .then(()=>{
        console.log("Server is connected to MongoDB");
    })
    .catch((err)=>{
        console.log("Error connecting to MongoDB")
        process.exit(1);
    })
}

module.exports=connectToDB;