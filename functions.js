// import { format } from "date-fns";
const format = require("date-fns/format")

const sendErrorMessage = (ctx, message) => {
    ctx.reply(message).then((msg) =>
        setTimeout(() => ctx.deleteMessage(msg.message_id), 5000)
    );
};

const formatDate = date => { 
    //date: yyyy-MM-dd

    return format(new Date(date), "EEE dd MMM yyyy")


}

const editErrorHandler = (e) => {
    console.log(e)
}

const keyFilterByProperty = (object, comparison) => { // comparison: number[]
    return Object.keys(object).filter(key => comparison.includes(object[key]));
}

module.exports = { sendErrorMessage, formatDate, editErrorHandler, keyFilterByProperty };