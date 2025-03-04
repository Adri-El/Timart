const {ObjectId}  = require('mongodb')
const database = require('../../lib/database')
const utilities = require('../../lib/utilities')
const Reaction = require('../../models/reaction')
const {send} = require("../notificationController/notificationController")


const reactionController = {}

reactionController.getReactions = ('/get-reactions', async (req, res)=>{
    //extract productID
    const productID = req.query.productID
    let set = req.query.set

    try{
        set = parseInt(set)
        const reactionCount = await database.db.collection(database.collection.reactions).countDocuments({productID: ObjectId(productID)})
        const limit = 5
        //get reactions
        if(set >= 0 && (set * limit < reactionCount)){
            let reactions = await database.db.collection(database.collection.reactions).aggregate([
                {$match: {productID: ObjectId(productID)}},
                {$sort: {_id: -1}},
                {$skip: set * limit},
                {$limit: limit},
                {$lookup: {from: "users", localField: "owner", foreignField: "primaryID", as: "owner"}}
            ]).toArray()
            
            reactions.forEach((element, index) => {
              reactions[index].owner = element.owner[0]  
            });
    
            //send response
            return utilities.setResponseData(res, 200, {'content-type': 'application/json'}, {statusCode: 200, reactions: reactions}, true)

        }
        else{
            return utilities.setResponseData(res, 201, {'content-type': 'application/json'}, {statusCode: 201, msg: "no more reactions"}, true)
        }   
         
    }
    catch(err){
        console.log(err) 
        //send new Token   
        utilities.setResponseData(res, 500, {'content-type': 'application/json'}, {statusCode: 500, msg: "something went wrong with the server"}, true)
        return
    }
    

})

reactionController.addReaction = async(req, res, payload, productObj)=>{
    //extract decoded token
    const decodedToken = req.decodedToken
    const newToken =  utilities.jwt('sign', {userID: decodedToken.userID, tokenFor: decodedToken.tokenFor})
    try{

        //make sure reaction is not null
        if(payload.reaction === null){
            return utilities.setResponseData(res, 400, {'content-type': 'application/json'}, {statusCode: 400, msg: "can't add null as a first reaction", timartToken: newToken}, true)
        }

        //trim the reaction
        payload.reaction = payload.reaction.trim()
            
        //add owner of reaction
        payload.owner = ObjectId(decodedToken.userID)

        //add productID to payload
        payload.productID = productObj._id

        //store the reaction
        const savedReaction = await new Reaction(payload).save()

        // update product reaction array
        await database.db.collection(database.collection.products).updateOne({_id: productObj._id}, {$addToSet: {reactions: savedReaction.insertedId}})

        //get reaction data

        let reactionObj = await database.db.collection(database.collection.reactions).aggregate([
            {$match: {_id: savedReaction.insertedId}}, 
            {$lookup: {from: "users", localField: "owner", foreignField: "primaryID", as: "owner"}}
        ]).toArray()

        reactionObj = reactionObj[0]
        reactionObj.owner = reactionObj.owner[0]

        //send notification
        await send("reaction", {...reactionObj}, reactionObj.owner.primaryID, productObj.owner)

        //send new token
        utilities.setResponseData(res, 200, {'content-type': 'application/json'}, {statusCode: 200, reactionData: reactionObj, timartToken: newToken}, true)
    

                
    }
    catch(err){
        console.log(err) 
        //send new Token   
        utilities.setResponseData(res, 500, {'content-type': 'application/json'}, {statusCode: 500, msg: "something went wrong with the server", timartToken: newToken}, true)
        return
    }
    
}



reactionController.deleteReaction = async (req, res, reactionObj)=>{
    //extract decoded token
    const decodedToken = req.decodedToken
    const newToken =  utilities.jwt('sign', {userID: decodedToken.userID, tokenFor: decodedToken.tokenFor})

    try{
        
        // delete reaction
        await database.deleteOne({_id: reactionObj._id},  database.collection.reactions)

        //remove reaction from reaction array in product
        await database.db.collection(database.collection.products).updateOne({_id: reactionObj.productID}, {$pull: {reactions: reactionObj._id}})

        //send new token
        utilities.setResponseData(res, 200, {'content-type': 'application/json'}, {statusCode: 200, msg: 'success', timartToken: newToken}, true)

    }
    catch(err){
        console.log(err) 
        //send new Token   
        utilities.setResponseData(res, 500, {'content-type': 'application/json'}, {statusCode: 500, msg: "something went wrong with the server", timartToken: newToken}, true)
        return
    }
    
}


reactionController.updateReaction = ('/update-reaction', async (req, res)=>{
    //extract decoded token
    const decodedToken = req.decodedToken
    const newToken =  utilities.jwt('sign', {userID: decodedToken.userID, tokenFor: decodedToken.tokenFor})
    let productID = req.query.productID
    try{
        //extract payload
        const payload = JSON.parse(req.body)
        //check if the data is valid
        if(utilities.reactionValidator(payload, ['reaction']).isValid){
            
            //convert productID from a string to an objectID
            productID = ObjectId(productID)

            //check if the product exists
            const productObj = await database.findOne({_id: productID}, database.collection.products, ["_id", "owner"], 1)

            if(productObj){
                //check if the user has reacted to the product before
                const userReactionObj = await database.findOne({$and: [{productID: productID}, {owner: ObjectId(decodedToken.userID)}]}, database.collection.reactions)

                if(userReactionObj){
                    //check if the new reaction is the same as the old one
                    if(userReactionObj.reaction === payload.reaction){
                        //send new token
                        return utilities.setResponseData(res, 400, {'content-type': 'application/json'}, {statusCode: 400, msg: "can't give the same reaction twice", timartToken: newToken}, true)
                    }

                    //check the value of reaction, if it is null, delete the reaction, if not add a new reaction
                    if(payload.reaction !== null){
                        //trim payload reaction
                        payload.reaction = payload.reaction.trim()
                        // update reaction
                        await database.updateOne({_id: userReactionObj._id}, database.collection.reactions, payload)

                        //extract the details of the owner of the reaction for presentation

                        let  updatedReactionObj = await database.db.collection(database.collection.reactions).aggregate([
                            {$match: {_id: userReactionObj._id}}, 
                            {$lookup: {from: "users", localField: "owner", foreignField: "primaryID", as: "owner"}}
                        ]).toArray()

                        updatedReactionObj = updatedReactionObj[0]
                        updatedReactionObj.owner = updatedReactionObj.owner[0]

                        //send new token
                        utilities.setResponseData(res, 200, {'content-type': 'application/json'}, {statusCode: 200, reactionData: updatedReactionObj, timartToken: newToken}, true)

                    }
                    else{
                        //delete the reaction
                        reactionController.deleteReaction(req, res, userReactionObj)
                    }

                }
                else{
                    //add a new reaction
                    return reactionController.addReaction(req, res, payload, productObj)

                }

            }
            else{
                //send new token
                utilities.setResponseData(res, 400, {'content-type': 'application/json'}, {statusCode: 400, msg: `This product doesn't exist`, timartToken: newToken}, true)

            }

        }else{
            //send new token
            utilities.setResponseData(res, 400, {'content-type': 'application/json'}, {statusCode: 400, errorObj: utilities.reactionValidator(payload, ['reaction']), timartToken: newToken}, true)  
        }
    }
    catch(err){
        console.log(err) 
        //send new Token   
        utilities.setResponseData(res, 500, {'content-type': 'application/json'}, {statusCode: 500, msg: "something went wrong with the server", timartToken: newToken}, true)
        return
    }
    
})

module.exports = reactionController